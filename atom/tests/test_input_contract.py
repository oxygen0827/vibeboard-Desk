import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from app_input import validate_input_bundle, validate_input_manifest


class InputContractTests(unittest.TestCase):
    def bundle(self):
        return {'manifest': {'input': {'version': 1, 'profile': 'five-way', 'back': 'root'}}, 'files': {'index.html': '<button>启动</button>'}}

    def test_missing_legacy_is_readable_but_not_admitted(self):
        b = self.bundle(); del b['manifest']['input']
        self.assertIsNone(validate_input_bundle(b, required=False))
        with self.assertRaises(ValueError): validate_input_bundle(b)

    def test_bad_version_profile_and_unknown_keys(self):
        for field, value in [('version', True), ('version', 2), ('profile', 'mouse'), ('back', 'history'), ('scene', 'magic'), ('approved', True)]:
            b = self.bundle(); b['manifest']['input'][field] = value
            with self.assertRaises(ValueError): validate_input_bundle(b)

    def test_canvas_requires_explicit_classification_and_controls(self):
        b = self.bundle(); b['files']['index.html'] = '<canvas></canvas>'
        with self.assertRaises(ValueError): validate_input_bundle(b)
        b['manifest']['input']['scene'] = 'controls'
        with self.assertRaises(ValueError): validate_input_bundle(b)
        b['files']['index.html'] += '<button>重置</button>'
        validate_input_bundle(b)
        b['manifest']['input']['scene'] = 'passive'
        b['files']['index.html'] = '<canvas></canvas>'
        validate_input_bundle(b)

    def test_custom_back_and_nonsemantic_click_controls(self):
        b = self.bundle(); b['manifest']['input']['back'] = 'custom'
        with self.assertRaises(ValueError): validate_input_bundle(b)
        b['files']['logic.js'] = 'AtomApp.navigation.setBackHandler(back);'
        validate_input_bundle(b)
        b['files']['index.html'] = '<div onclick="go()">启动</div>'
        with self.assertRaises(ValueError): validate_input_bundle(b)
        b['files']['index.html'] = '<div onclick="go()" role="button" tabindex="0">启动</div>'
        validate_input_bundle(b)
