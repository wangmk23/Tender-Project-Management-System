import ast
from pathlib import Path
import unittest
from tools import compile_module_patches as compiler
ROOT=Path(__file__).resolve().parents[1]
MODULES=('local_project_files','local_files_windows','local_files_index')

class IntegrationTests(unittest.TestCase):
    def test_controlled_modules_are_compiled_and_verified(self):
        source=(ROOT/'tools/compile_module_patches.py').read_text('utf-8')
        for name in MODULES:
            self.assertIn(name,compiler.CONTROLLED_MODULE_SIGNATURES)
            self.assertGreaterEqual(source.count(repr(name))+source.count('"'+name+'"'),4)

    def test_backend_modules_have_the_controlled_signature(self):
        for name in MODULES:
            path=ROOT/'src/backend_patches'/f'{name}.py'
            self.assertTrue(path.is_file(),f'parallel backend dependency missing: {name}')
            code=compile(path.read_text('utf-8'),str(path),'exec')
            self.assertTrue(compiler._is_controlled_module(code,compiler.CONTROLLED_MODULE_SIGNATURES[name]))

    def test_desktop_registers_after_existing_gates_before_server_start(self):
        source=(ROOT/'src/backend_patches/desktop_app_replacements.py').read_text('utf-8')
        self.assertLess(source.index('account_permissions.register('),source.index('local_project_files.register('))
        self.assertLess(source.index('local_project_files.register('),source.index('_FLASK_THREAD.start()'))
        tree=ast.parse(source)
        call=next(node for node in ast.walk(tree) if isinstance(node,ast.Call) and ast.unparse(node.func)=='local_project_files.register')
        self.assertEqual(ast.unparse(call.args[0]),'server_app')
        self.assertEqual({k.arg for k in call.keywords},{'choose_folder','open_folder'})
        self.assertIn('webview.FOLDER_DIALOG',ast.unparse(call))
        self.assertIn('os.startfile',ast.unparse(call))

    def test_candidate_requires_all_modules_and_desktop_import(self):
        source=(ROOT/'tools/build_candidate.py').read_text('utf-8')
        for name in MODULES:self.assertIn('"'+name+'": 1',source)
        self.assertIn('local_files_runtime_checks',source)

if __name__=='__main__':unittest.main()
