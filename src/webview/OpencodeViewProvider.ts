import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";

export class OpencodeViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _serverUrl?: string;
  private _error?: { message: string; showInstallHint: boolean };
  private _sidebarType: "primary" | "auxiliary" | null = null;
  private _isDevMode = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _logger: vscode.OutputChannel,
  ) {}

  setDevMode(enabled: boolean) {
    this._isDevMode = enabled;
  }

  get isViewVisible(): boolean {
    return !!this._view?.visible;
  }

  get sidebarType(): "primary" | "auxiliary" | null {
    return this._sidebarType;
  }

  set sidebarType(type: "primary" | "auxiliary" | null) {
    this._sidebarType = type;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    // Handle paste requests relayed from the iframe through the webview script
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "paste-request") {
        const text = await vscode.env.clipboard.readText();
        webviewView.webview.postMessage({ type: "paste-response", text });
      }
      if (message.type === "copy-request" && typeof message.text === "string") {
        await vscode.env.clipboard.writeText(message.text);
      }
      if (message.type === "play-audio" && typeof message.src === "string") {
        void this._playAudioDataUri(message.src);
      }
      if (message.type === "open-external" && typeof message.url === "string") {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
    });

    this._renderCurrentState();
  }

  setServerUrl(url: string) {
    this._logger.appendLine(`[OpenCode] Setting server URL: ${url}`);
    this._serverUrl = url;
    this._error = undefined;
    this._renderCurrentState();
  }

  public addToChat(filePath: string) {
    if (this._view) {
      this._view.webview.postMessage({ type: "insert-text", text: filePath });
    }
  }

  setError(message: string, showInstallHint = true) {
    this._logger.appendLine(`[OpenCode] Setting error: ${message}`);
    this._error = { message, showInstallHint };
    this._serverUrl = undefined;
    this._renderCurrentState();
  }

  setLoading() {
    this._logger.appendLine("[OpenCode] Setting loading state");
    this._serverUrl = undefined;
    this._error = undefined;
    this._renderCurrentState();
  }

  private _renderCurrentState() {
    if (!this._view) {
      this._logger.appendLine(
        "[OpenCode] _renderCurrentState called before view resolved; deferring.",
      );
      return;
    }

    try {
      if (this._error) {
        this._view.webview.html = this._getErrorHtml(
          this._error.message,
          this._error.showInstallHint,
        );
        return;
      }

      if (this._serverUrl) {
        this._view.webview.html = this._getIframeHtml(this._serverUrl);
        return;
      }

      this._setLoadingHtml();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._logger.appendLine(
        `[OpenCode] Failed to render view state: ${message}`,
      );
      try {
        this._view.webview.html = this._getErrorHtml(
          `Failed to render view: ${message}`,
          false,
        );
      } catch {
        // Last resort: show a plain error so the view is not stuck loading.
        this._view.webview.html = `<!doctype html><html><body style="color:var(--vscode-foreground);font-family:var(--vscode-font-family);padding:20px;">Failed to render OpenCode view: ${message}</body></html>`;
      }
    }
  }

  private _readTemplate(name: string): string {
    const templatePath = path.join(__dirname, "templates", name);
    this._logger.appendLine(`[OpenCode] Reading template: ${templatePath}`);
    try {
      return fs.readFileSync(templatePath, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._logger.appendLine(
        `[OpenCode] Failed to read template ${name}: ${message}`,
      );
      throw err;
    }
  }

  private _processTemplate(name: string): string {
    return this._readTemplate(name).replaceAll(
      "{{DEV_MODE}}",
      this._isDevMode ? "flex" : "none",
    );
  }

  private _setLoadingHtml() {
    if (!this._view) return;
    this._view.webview.html = this._processTemplate("loading.html");
  }

  private _getIframeHtml(serverUrl: string): string {
    let serverOrigin = serverUrl;
    try {
      serverOrigin = new URL(serverUrl).origin;
    } catch {}

    return this._processTemplate("iframe.html")
      .replaceAll("{{SERVER_URL}}", serverUrl)
      .replaceAll("{{SERVER_ORIGIN}}", serverOrigin);
  }

  private _getErrorHtml(message: string, showInstallHint: boolean): string {
    const installHint = showInstallHint
      ? "<p>Make sure <code>opencode</code> is installed and available in your PATH.</p>"
      : "";

    return this._processTemplate("error.html")
      .replaceAll("{{ERROR_MESSAGE}}", message)
      .replaceAll("{{INSTALL_HINT}}", installHint);
  }

  // ── System-level audio playback for environments without codec support ──
  // When the webview cannot play audio (e.g. stock VS Code lacks AAC codecs),
  // we decode the data URI, write a temp file, and play via system commands.
  private async _playAudioDataUri(dataUri: string) {
    try {
      const match = dataUri.match(
        /^data:audio\/([a-zA-Z0-9.+-]+);base64,(.+)$/,
      );
      if (!match) return;

      const ext = match[1];
      const base64 = match[2];
      const buffer = Buffer.from(base64, "base64");

      const tmpFile = path.join(
        os.tmpdir(),
        `opencode-audio-${Date.now()}.${ext}`,
      );
      await fs.promises.writeFile(tmpFile, buffer);

      const cleanup = async () => {
        try {
          await fs.promises.unlink(tmpFile);
        } catch {}
      };

      let cmd: string;
      switch (process.platform) {
        case "darwin":
          cmd = `afplay "${tmpFile}"`;
          break;
        case "linux":
          // Try paplay (PulseAudio) first, fall back to aplay (ALSA)
          cmd = `paplay "${tmpFile}" 2>/dev/null || aplay "${tmpFile}"`;
          break;
        case "win32":
          // PowerShell MediaPlayer can handle most audio formats
          cmd = `powershell -c "(New-Object Media.SoundPlayer '${tmpFile}').PlaySync()"`;
          break;
        default:
          await cleanup();
          return;
      }

      exec(cmd, { timeout: 10_000 }, (err) => {
        void cleanup();
        if (err) {
          console.error("[OpenCode] System audio playback failed:", err.message);
        }
      });
    } catch (err) {
      console.error("[OpenCode] Failed to play audio data URI:", err);
    }
  }
}
