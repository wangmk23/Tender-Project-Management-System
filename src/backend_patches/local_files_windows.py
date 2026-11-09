"""local-files-windows-v1: Read-only directory identity and strict local-path validation."""
import os
import stat
from pathlib import Path
from contextlib import ExitStack, contextmanager


def validate_name(value):
    if (not isinstance(value,str) or not value or value in ('.','..') or
        len(value)>240 or value[-1] in '. ' or any(ord(c)<32 or c in '<>:"/\\|?*' for c in value) or
        value.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}):
        raise ValueError('目录名称无效')
    return value


def is_link(path):
    st=os.lstat(path)
    return bool(getattr(st,'st_file_attributes',0)&0x400) or Path(path).is_symlink()


def windows_drive_type(anchor):
    import ctypes
    return ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(anchor))


def local_path(value):
    if not isinstance(value,(str,Path)):
        raise ValueError('目录路径无效')
    text=str(value)
    if text.startswith(('\\\\','//')) or any(ord(c)<32 for c in text):
        raise ValueError('仅支持本机普通目录')
    path=Path(text)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('需要本机绝对路径')
    if os.name == 'nt' and windows_drive_type(path.anchor) not in (2, 3):
        raise ValueError('仅支持本机固定磁盘和可移动磁盘')
    return path


def local_directory(value):
    path = local_path(value)
    for part in [*reversed(path.parents),path]:
        if is_link(part): raise ValueError('不支持目录联接或符号链接')
    if not path.is_dir(): raise ValueError('目录不可用')
    return path


def relative_path(value):
    if (not isinstance(value,str) or '\\' in value or ':' in value or value.startswith('/')
            or any(ord(c) < 32 for c in value) or any(p in ('.','..') for p in value.split('/'))):
        raise ValueError('相对路径无效')
    return value


class DirectoryIdentity:
    """Windows file IDs survive moves; no live handles retained between calls."""
    def __init__(self):
        if os.name=='nt':
            import ctypes
            from ctypes import wintypes as w
            self.c=ctypes; self.w=w; self.k=ctypes.WinDLL('kernel32',use_last_error=True)
            self.k.CreateFileW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,w.LPVOID,w.DWORD,w.DWORD,w.HANDLE]; self.k.CreateFileW.restype=w.HANDLE
            self.k.CloseHandle.argtypes=[w.HANDLE]
            self.k.GetFileInformationByHandle.argtypes=[w.HANDLE,w.LPVOID]
            self.k.GetFinalPathNameByHandleW.argtypes=[w.HANDLE,w.LPWSTR,w.DWORD,w.DWORD]
            self.k.OpenFileById.argtypes=[w.HANDLE,w.LPVOID,w.DWORD,w.DWORD,w.LPVOID,w.DWORD]; self.k.OpenFileById.restype=w.HANDLE
            self.k.GetFileInformationByHandleEx.argtypes=[w.HANDLE,ctypes.c_int,w.LPVOID,w.DWORD]
            self.k.GetFileInformationByHandleEx.restype=w.BOOL
            self.nt=ctypes.WinDLL('ntdll')
            self.nt.NtCreateFile.argtypes=[ctypes.POINTER(w.HANDLE),w.DWORD,w.LPVOID,w.LPVOID,
                                          w.LPVOID,w.DWORD,w.DWORD,w.DWORD,w.DWORD,w.LPVOID,w.DWORD]
            self.nt.NtCreateFile.restype=w.LONG
            self.nt.RtlNtStatusToDosError.argtypes=[w.LONG]
            self.nt.RtlNtStatusToDosError.restype=w.DWORD

            class UnicodeString(ctypes.Structure):
                _fields_=[('length',w.USHORT),('maximum',w.USHORT),('buffer',w.LPWSTR)]
            class ObjectAttributes(ctypes.Structure):
                _fields_=[('length',w.DWORD),('root',w.HANDLE),('name',ctypes.POINTER(UnicodeString)),
                          ('flags',w.DWORD),('security',w.LPVOID),('qos',w.LPVOID)]
            class IOStatus(ctypes.Structure):
                _fields_=[('status_or_pointer',w.LPVOID),('information',ctypes.c_size_t)]
            class DirectoryRecord(ctypes.Structure):
                _fields_=[('next',w.DWORD),('index',w.DWORD),('created',ctypes.c_int64),
                          ('accessed',ctypes.c_int64),('written',ctypes.c_int64),('changed',ctypes.c_int64),
                          ('size',ctypes.c_int64),('allocated',ctypes.c_int64),('attributes',w.DWORD),
                          ('name_bytes',w.DWORD),('ea_size',w.DWORD),('short_length',ctypes.c_byte),
                          ('short_name',w.WCHAR*12),('file_id',ctypes.c_int64),('name',w.WCHAR)]
            self.UnicodeString=UnicodeString
            self.ObjectAttributes=ObjectAttributes
            self.IOStatus=IOStatus
            self.DirectoryRecord=DirectoryRecord
    @contextmanager
    def handle(self,path,*,access=0,share=7):
        h=self.k.CreateFileW(str(path),access,share,None,3,0x02000000|0x00200000,None)
        if h==self.c.c_void_p(-1).value: raise OSError('目录不可用')
        try: yield h
        finally: self.k.CloseHandle(h)
    def identify(self,path):
        path=local_path(path)
        if os.name!='nt':
            st=local_directory(path).stat(); return {'volume':str(st.st_dev),'id':str(st.st_ino),'drive':path.anchor,'supported':False}
        with self.pin_directory(path, root=path) as h:
            info = self.file_info(h)
            if info.attributes & 0x400: raise ValueError('不支持目录联接')
            return {'volume':str(info.volume),'id':str((info.high<<32)|info.low),'drive':path.anchor,'supported':True}

    def file_info(self, handle):
        c,w=self.c,self.w
        class Info(c.Structure):
            _fields_=[('attributes',w.DWORD),('creation',w.FILETIME),('access',w.FILETIME),('write',w.FILETIME),('volume',w.DWORD),('sizehi',w.DWORD),('sizelo',w.DWORD),('links',w.DWORD),('high',w.DWORD),('low',w.DWORD)]
        info = Info()
        if not self.k.GetFileInformationByHandle(handle, c.byref(info)):
            raise OSError('文件身份不可用')
        return info

    def final_path(self, handle):
        buffer = self.c.create_unicode_buffer(32768)
        count = self.k.GetFinalPathNameByHandleW(handle, buffer, len(buffer), 0)
        if not count or count >= len(buffer):
            raise OSError('文件路径不可用')
        return buffer.value.removeprefix('\\\\?\\')

    @contextmanager
    def pin_directory(self, path, *, root, identity=None):
        """Keep verified directory components in place while admitting one operation."""
        root = Path(root)
        path = local_path(path)
        if not path.is_relative_to(root):
            raise ValueError('目录不在项目关联范围内')
        if os.name != 'nt':
            local_directory(path)
            if identity is not None:
                current = self.identify(root)
                if any(current[key] != identity[key] for key in ('volume', 'id')):
                    raise ValueError('项目目录身份已变化')
            yield None
            return
        with ExitStack() as handles:
            parent = None
            for component in (*reversed(path.parents), path):
                # FILE_LIST_DIRECTORY shares reads/writes but prevents a concurrent
                # rename until this short admission or directory enumeration ends.
                if parent is None:
                    handle = handles.enter_context(self.handle(component, access=1, share=3))
                else:
                    handle = self._open_child_at(parent, component.name)
                    handles.callback(self.k.CloseHandle, handle)
                info = self.file_info(handle)
                if info.attributes & 0x400 or not info.attributes & 0x10:
                    raise ValueError('不支持目录联接')
                if component == root and identity is not None:
                    file_id = str((info.high << 32) | info.low)
                    if str(info.volume) != identity['volume'] or file_id != identity['id']:
                        raise ValueError('项目目录身份已变化')
                parent = handle
            yield parent

    def _open_child_at(self, parent, name, *, directory=True, create=False):
        """Open one component relative to its parent, or exclusively create a directory."""
        if self.file_info(parent).attributes & 0x400:
            raise ValueError('目录已变成联接')
        name = validate_name(name)
        length = len(name.encode('utf-16-le'))
        filename = self.UnicodeString(length, length+2, name)
        attributes = self.ObjectAttributes(self.c.sizeof(self.ObjectAttributes), parent,
                                            self.c.pointer(filename), 0x1040, None, None)
        result = self.w.HANDLE()
        status = self.IOStatus()
        # OBJ_DONT_REPARSE, FILE_DIRECTORY_FILE, FILE_OPEN_REPARSE_POINT;
        # FILE_CREATE never accepts an existing directory at this name.
        options = 0x00200020 | (0x01 if directory else 0x40)
        share = 3 if directory else 7
        code = self.nt.NtCreateFile(self.c.byref(result),0x100081,self.c.byref(attributes),
                                    self.c.byref(status),None,0x80,share,2 if create else 1,
                                    options,None,0)
        if code < 0:
            raise self.c.WinError(self.nt.RtlNtStatusToDosError(code))
        return result.value

    @contextmanager
    def create_child_directory(self, parent_handle, parent, name):
        if parent_handle is None:
            (Path(parent)/validate_name(name)).mkdir()
            yield None
            return
        handle = self._open_child_at(parent_handle, name, create=True)
        try:
            yield handle
        finally:
            self.k.CloseHandle(handle)

    def read_pinned_directory(self, handle):
        """Enumerate metadata from the opened object instead of resolving its path again."""
        if self.file_info(handle).attributes & 0x400:
            raise ValueError('目录已变成联接')
        buffer = self.c.create_string_buffer(65536)
        info_class = 11  # FileIdBothDirectoryRestartInfo
        name_offset = self.DirectoryRecord.name.offset
        while self.k.GetFileInformationByHandleEx(handle,info_class,buffer,len(buffer)):
            info_class = 10  # FileIdBothDirectoryInfo
            offset = 0
            while True:
                entry = self.DirectoryRecord.from_buffer(buffer, offset)
                start = offset + name_offset
                end = start + entry.name_bytes
                if end > len(buffer) or entry.name_bytes % 2:
                    raise OSError('无效的目录记录')
                name = self.c.string_at(self.c.addressof(buffer)+start,entry.name_bytes).decode('utf-16-le')
                if name not in ('.','..'):
                    kind = 'link' if entry.attributes & 0x400 else 'directory' if entry.attributes & 0x10 else 'file'
                    modified = (entry.written - 116444736000000000) / 10000000
                    yield name,kind,entry.size if kind == 'file' else 0,modified
                if not entry.next:
                    break
                if entry.next < end-offset or offset+entry.next+name_offset >= len(buffer):
                    raise OSError('无效的目录记录偏移')
                offset += entry.next
        error = self.c.get_last_error()
        if error != 18:  # ERROR_NO_MORE_FILES
            raise self.c.WinError(error)

    @contextmanager
    def read_directory(self, path, *, root, identity):
        with self.pin_directory(path, root=root, identity=identity) as handle:
            yield self.read_pinned_directory(handle) if handle is not None else None

    def open_content(self, root, relative, identity):
        """Open a regular file for reading, and verify the opened Windows handle's path."""
        root = local_directory(root)
        parts = relative_path(relative).split('/')
        path = root.joinpath(*(validate_name(part) for part in parts))
        with self.pin_directory(path.parent, root=root, identity=identity) as parent:
            return self._open_regular_file(path, parent)

    def _open_regular_file(self, path, parent):
        if os.name == 'nt':
            import msvcrt
            handle = self._open_child_at(parent, path.name, directory=False)
            try:
                if self.file_info(handle).attributes & (0x400 | 0x10):
                    raise ValueError('只允许读取普通文件')
                # The handle paths expand any Windows short names in the parent.
                expected = Path(self.final_path(parent)) / path.name
                if os.path.normcase(self.final_path(handle)) != os.path.normcase(str(expected)):
                    raise ValueError('文件路径已变化')
                fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
                handle = None  # The file descriptor now owns the native handle.
            finally:
                if handle is not None:
                    self.k.CloseHandle(handle)
        else:
            if is_link(path) or not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError('只允许读取普通文件')
            fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError('只允许读取普通文件')
            return os.fdopen(fd, 'rb')
        except BaseException:
            os.close(fd)
            raise
    def resolve(self,path,identity):
        try:
            current=self.identify(path)
            if (current['volume'],current['id'])==(identity['volume'],identity['id']): return str(path),'available'
            return str(path),'replaced'
        except (OSError,ValueError): pass
        if os.name!='nt' or not identity.get('supported'): return str(path),'unsupported'
        c,w=self.c,self.w
        class IdUnion(c.Union):
            _fields_=[('file_id',c.c_longlong),('extended',c.c_byte*16)]
        class Descriptor(c.Structure):
            _fields_=[('size',w.DWORD),('type',c.c_int),('value',IdUnion)]
        desc=Descriptor(); desc.size=c.sizeof(desc); desc.type=0; desc.value.file_id=int(identity['id'])
        try:
            with self.handle(identity['drive']) as volume:
                h=self.k.OpenFileById(volume,c.byref(desc),0,7,None,0x02000000)
                if h==c.c_void_p(-1).value: return str(path),'missing'
                try:
                    found=self.final_path(h)
                    check=self.identify(found)
                    if (check['volume'],check['id'])!=(identity['volume'],identity['id']): return str(path),'missing'
                    return found,'moved'
                finally: self.k.CloseHandle(h)
        except (OSError,ValueError): return str(path),'missing'
