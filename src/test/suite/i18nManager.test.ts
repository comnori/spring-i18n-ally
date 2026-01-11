import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { I18nManager } from '../../i18nManager';

suite('I18nManager Test Suite', () => {
    vscode.window.showInformationMessage('Start I18nManager tests.');

    test('Singleton Instance', () => {
        const instance1 = I18nManager.getInstance();
        const instance2 = I18nManager.getInstance();
        assert.strictEqual(instance1, instance2, 'Singleton should return the same instance');
    });

    test('Initialization should not crash', async () => {
        const manager = I18nManager.getInstance();
        try {
            await manager.init();
            assert.ok(true, 'Init completed');
        } catch (e) {
            assert.fail('Init failed: ' + e);
        }
    });

    // Note: Deeper functional tests require a workspace with actual properties files.
    // We would typically create a temporary workspace or fixtures.
    // For now, we verify the structure and critical methods existence.

    test('Method existence', () => {
        const manager = I18nManager.getInstance();
        assert.ok(typeof manager.getTranslation === 'function');
        assert.ok(typeof manager.reloadProperties === 'function');
    });
});
