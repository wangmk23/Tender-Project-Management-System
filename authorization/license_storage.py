"""Small, dependency-free commit helpers; signing formats remain unchanged."""
import os
from pathlib import Path
import tempfile
from cryptography.hazmat.primitives import serialization


class RecordWriteError(OSError):
    """The license was committed. Only the separate audit record needs retrying."""
    def __init__(self, document, output, organization, cause):
        self.document, self.output, self.organization = document, Path(output), organization
        super().__init__(f'授权已写入 {output}，但授权记录未保存：{cause}。请补记记录，不要重复签发。')


def atomic_write(path, data, *, validate=None, prefix='.issuer-file-'):
    path = Path(path)
    descriptor, name = tempfile.mkstemp(prefix=prefix, dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if validate:
            validate(temporary.read_bytes())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
    return path


def replace_private_key(path, key, new_password):
    if len(new_password) < 10:
        raise ValueError('新密码至少10位。')
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    data = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.BestAvailableEncryption(new_password.encode('utf-8')))
    def validate(written):
        loaded = serialization.load_pem_private_key(written, password=new_password.encode('utf-8'))
        if loaded.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo) != public:
            raise ValueError('新私钥校验失败，原文件未替换。')
    return atomic_write(path, data, validate=validate, prefix='.issuer-key-')
