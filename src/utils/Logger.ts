import * as vscode from 'vscode';

export class Logger {
    private static _outputChannel: vscode.OutputChannel;

    public static get channel(): vscode.OutputChannel {
        if (!this._outputChannel) {
            this._outputChannel = vscode.window.createOutputChannel('spring-i18n-ally');
        }
        return this._outputChannel;
    }

    public static info(message: string) {
        this.channel.appendLine(`[INFO] ${new Date().toLocaleTimeString()} ${message}`);
    }

    public static warn(message: string) {
        this.channel.appendLine(`[WARN] ${new Date().toLocaleTimeString()} ${message}`);
    }

    public static error(message: string, error?: any) {
        this.channel.appendLine(`[ERROR] ${new Date().toLocaleTimeString()} ${message}`);
        if (error) {
            if (error instanceof Error) {
                this.channel.appendLine(error.stack || error.message);
            } else {
                this.channel.appendLine(JSON.stringify(error, null, 2));
            }
        }
    }

    public static show() {
        this.channel.show();
    }
}
