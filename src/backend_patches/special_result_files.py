"""Price documents for saved special-result suppliers (special-result-files-v1)."""
from pathlib import Path
import re

from flask import jsonify, request, session
from sqlalchemy import text

if __package__:
    from . import attachment_lifecycle_routes as lifecycle, attachment_validation, recycle_bin
else:
    import attachment_lifecycle_routes as lifecycle
    import attachment_validation
    import recycle_bin


def _saved_entry(db, models, project, lot_id, registration_id):
    if __package__:
        from .special_results import saved_entry
    else:
        from special_results import saved_entry
    return saved_entry(db, models, project, lot_id, registration_id)


def _visible(db, attachment, pid, rid, prefix):
    hidden = recycle_bin.hidden_attachment_ids(db, project_id=pid)
    rows = attachment.query.filter_by(project_id=pid, registration_id=rid).filter(
        attachment.stored_name.startswith(prefix)
    ).order_by(attachment.id).all()
    return [row for row in rows if row.id not in hidden]


def _validate_uploads(ctx, files):
    if not files:
        return '请选择报价文件', 400
    for file in files:
        if file.stream.seek(0, 2) > ctx['MAX_FILE_SIZE']:
            return '文件超过当前附件大小上限', 413
        file.stream.seek(0)
        if not ctx['allowed_file'](file.filename):
            return '不支持此文件格式', 400
        error = attachment_validation.validate_file(file)
        if error:
            return error, 400
    return None


def register(app, db, models, authorize):
    @app.route('/api/projects/<int:pid>/special-results/registrations/<int:rid>/attachments',
               methods=['GET', 'POST'])
    def special_result_attachments(pid, rid):
        write = request.method == 'POST'
        project, denied = authorize(models, pid=pid, write=write)
        if denied is not None:
            return denied
        raw_lot = request.args.get('lot_id', '')
        if raw_lot and not re.fullmatch(r'[1-9][0-9]{0,17}', raw_lot):
            return jsonify(error='采购包编号无效'), 400
        lot_id = int(raw_lot) if raw_lot else None
        ctx = app.extensions['runtime_context']
        attachment = ctx['Attachment']
        # Keep the registration foreign key and namespace the immutable stored name
        # by lot. Renaming a document or editing its description preserves its owner.
        prefix = f'result-{lot_id or 0}-'
        missing = '该采购包的结果中没有此报名供应商'
        if not _saved_entry(db, models, project, lot_id, rid):
            return jsonify(error=missing), 404
        if not write:
            return jsonify(attachments=[row.to_dict() for row in _visible(db, attachment, pid, rid, prefix)])
        if getattr(project, 'is_terminated', False):
            return jsonify(error='项目已关闭'), 400
        files = [file for file in request.files.getlist('files') if file.filename]
        error = _validate_uploads(ctx, files)
        if error:
            return jsonify(error=error[0]), error[1]

        staged = []
        discard = set()
        try:
            folder = Path(ctx['get_upload_path'](pid))
            for file in files:
                filename = ctx['sanitize_display_filename'](Path(file.filename.replace('\\', '/')).name)
                stored = prefix + ctx['generate_stored_filename'](filename)
                path = folder / stored
                relative = f'{pid}/{stored}'
                ctx['_validate_file_path'](path, relative)
                discard.add(path)
                file.save(path)
                size = path.stat().st_size
                digest = ctx['_sha256_file'](path)
                ctx['_encrypt_uploaded_file'](path)
                staged.append((path, attachment(
                    project_id=pid, registration_id=rid, filename=filename,
                    stored_name=stored, file_path=relative, file_size=size, sha256=digest,
                    mime_type=lifecycle.DEFAULT_MIME_MAP.get(path.suffix[1:].lower(), 'application/octet-stream'),
                    description='供应商报价文件', uploaded_by=session['user_id'],
                )))

            # SQLite serializes writers. Acquire the write lock before reading
            # membership and duplicate keys again, without modifying any row.
            db.session.execute(text('UPDATE attachments SET id=id WHERE 0'))
            db.session.refresh(project)
            if getattr(project, 'is_terminated', False) or recycle_bin.is_deleted(db, 'project', pid):
                db.session.rollback()
                return jsonify(error='项目已关闭或移入回收站'), 409
            if not _saved_entry(db, models, project, lot_id, rid):
                db.session.rollback()
                return jsonify(error=missing), 409
            rows = _visible(db, attachment, pid, rid, prefix)
            seen = {(row.filename, row.sha256) for row in rows}
            keep = set()
            for path, row in staged:
                key = (row.filename, row.sha256)
                if key in seen:
                    continue
                seen.add(key)
                db.session.add(row)
                rows.append(row)
                keep.add(path)
            db.session.flush()
            response = jsonify(attachments=[row.to_dict() for row in rows])
            db.session.commit()
            discard.difference_update(keep)
        except Exception:
            db.session.rollback()
            app.logger.exception('保存供应商报价文件失败')
            return jsonify(error='报价文件保存失败，请重试'), 503
        finally:
            for path in discard:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    app.logger.exception('无法清理本次上传的临时文件')
        if keep and callable(ctx.get('log_operation')):
            ctx['log_operation']('upload_attachment', 'project', pid, f'为报名供应商 {rid} 上传 {len(keep)} 个报价文件')
        return response
