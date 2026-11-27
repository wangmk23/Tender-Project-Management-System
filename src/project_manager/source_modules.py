"""Explicit business-module composition for the source application."""
from types import SimpleNamespace
from src.backend_patches import (
    account_permissions, attachment_validation, backup_settings, business_deadlines,
    business_input_validation, calendar_service, data_import, data_recovery, device_admission,
    public_licensing, recycle_bin, project_listing, notification_channels,
    local_project_files, media_preview, online_bidding, procurement_api,
    registration_routes, signed_attachments, software_updates, tender_guarantee,
    upload_limit_settings,
)


def register_modules(app, db, ctx):
    models = dict(ctx)
    models['db'] = db
    business_input_validation.install_bid_result_serialization(ctx['BidResult'])
    ctx['SupplierRegistration'].to_dict = lambda row: registration_routes.supplier_registration_to_dict(ctx, row)
    attachment_validation.register(app)
    software_updates.register(app, ctx['login_required'])
    online_bidding.register(app, db, models)
    tender_guarantee.register(app, db, models)
    business_deadlines.register(app, db, models)
    app.extensions['calendar_impact_provider'] = lambda year, snapshot: calendar_service.preview_impacts(
        db, ctx['Project'], year, snapshot, ctx['DATA_DIR'] / 'holiday_calendar')
    calendar_service.register(app, db, models)
    procurement_api.register(app, db, models)
    ctx.set_symbol('_TENDER_GUARANTEE_ENABLED', True)
    ctx.set_symbol('_PROCUREMENT_CATALOG_ENABLED', True)
    data_import.register_routes(app, db, models)
    signed_attachments.register_routes(app, db, {**models, 'attachment_response':ctx['_attachment_response']})
    media_preview.register(app, db, models)
    # Account registration replaces these preserved endpoints with transactional
    # handlers. Never expose a temporary unguarded implementation.
    for rule, endpoint, methods in [('/api/users','api_create_user',['POST']),
            ('/api/users/<int:uid>','api_update_user',['PUT']),
            ('/api/users/<int:uid>','api_delete_user',['DELETE'])]:
        app.add_url_rule(rule, endpoint, lambda **kw: ('',503), methods=methods)
    account_permissions.register(app, db, {**models,'validate_username':ctx['_validate_username']})
    device_admission.register(app, db, {**models, 'signed_attachment_endpoints':{'api_download_signed_attachment'}})
    runtime = SimpleNamespace(**dict(ctx))
    # Desktop callbacks resolve the live bridge only when the user invokes them.
    def choose_folder():
        callback = app.extensions.get('desktop_bridge', {}).get('choose_folder')
        if not callback:
            raise RuntimeError('请在主机桌面客户端选择目录')
        return callback()
    def open_folder(path):
        callback = app.extensions.get('desktop_bridge', {}).get('open_folder')
        if not callback:
            raise RuntimeError('请在主机桌面客户端打开目录')
        return callback(path)
    data_recovery.register(app, {**dict(ctx), 'protect_key':public_licensing._dpapi_protect,
        'choose_export_folder':lambda: ([value] if (value := choose_folder()) else [])})
    backup_settings.register(runtime, choose_folder=choose_folder, open_folder=open_folder)
    local_project_files.register(runtime, choose_folder=choose_folder, open_folder=open_folder)
    recycle_bin.register(app, db, ctx)
    project_listing.register(app, db, ctx)
    notification_channels.register(app, db, ctx)
    ctx.set_symbol('get_backup_dir', runtime.get_backup_dir)
    upload_limit_settings.install_upload_limit_settings(app, ctx.host_module, ctx['login_required'])
    app.extensions['source_runtime'] = runtime
