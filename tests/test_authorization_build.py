import ctypes
from pathlib import Path
import sys
import threading
import time
import unittest
from tools import build_authorization

@unittest.skipUnless(sys.platform=='win32','Windows file sharing semantics')
class BuildWorkspaceTests(unittest.TestCase):
    def test_cleanup_waits_for_temporary_executable_reader(self):
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
        kernel.CreateFileW.restype=wintypes.HANDLE
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        with build_authorization.build_workspace() as directory:
            target=Path(directory)/'build.exe';target.write_bytes(b'temporary executable')
            handle=kernel.CreateFileW(str(target),0x80000000,1,None,3,0,None)
            self.assertNotEqual(handle,ctypes.c_void_p(-1).value)
            worker=threading.Thread(target=lambda:(time.sleep(.2),kernel.CloseHandle(handle)))
            worker.start()
        worker.join()
        self.assertFalse(Path(directory).exists())
