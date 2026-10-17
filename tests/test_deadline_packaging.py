import unittest
from tools import compile_module_patches as patches

class DeadlinePackagingTests(unittest.TestCase):
    def test_all_new_runtime_modules_are_controlled_and_latest_baseline_is_supported(self):
        for name,marker in [('holiday_import','holiday-import-v1'),('deadline_rules','deadline-rules-v1'),('business_deadlines','business-deadlines-v1')]:
            self.assertEqual(patches.CONTROLLED_MODULE_SIGNATURES.get(name),marker)
        self.assertIn('v5.8.33',patches.BACKEND_VERSION_SOURCES)

if __name__ == '__main__': unittest.main()
