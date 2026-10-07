"""Disk-bound issuer: explicitly initialize on the administrator's chosen disk."""
import sys
import license_issuer as tool


def verify_disk():
    return tool.verify_bound_disk()


def guarded_issue(**kwargs):
    kwargs['bound_mode'] = True
    return tool.issue(**kwargs)


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    tool.APP_TITLE = '项目管理系统授权工具 · 绑定磁盘版'
    tool.APP_VERSION = '1.5-bound'
    try:
        return tool.cli(args, bound_mode=True)
    except (PermissionError, ValueError, OSError) as error:
        tool._attach_console()
        print(str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
