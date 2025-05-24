const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const tiktoken = require('tiktoken');

const { extractCode } = require('./commands/codeExtractor');
const { removeComments } = require('./commands/commentRemover');
const { getEffectiveIgnorePatterns } = require('./core/ignoreHelper');

let currentPanel = undefined;
let clipboardListener = undefined;
let encoder = null;

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context The extension context
 */
function activate(context) {
    console.log('Syntax Extractor is now active!');

    encoder = tiktoken.get_encoding("cl100k_base");

    registerCommands(context);
    setupTreeView(context);
    setupClipboardListener();
}

/**
 * Registers all commands for the extension
 * @param {vscode.ExtensionContext} context The extension context
 */
function registerCommands(context) {
    const commands = [
        { id: 'codeExtractor.extractCode', handler: (uri, uris) => handleExtractCode(context, uri, uris) },
        { id: 'syntaxExtractor.openExplorer', handler: () => handleOpenExplorer(context) },
        { id: 'codeExtractor.removeComments', handler: (uri, uris) => handleRemoveComments(uri, uris) }
    ];

    commands.forEach(cmd => {
        const disposable = vscode.commands.registerCommand(cmd.id, cmd.handler);
        context.subscriptions.push(disposable);
    });
}

/**
 * Handles the Extract Code Structure command
 * @param {vscode.ExtensionContext} context The extension context
 * @param {vscode.Uri} uri Single selected URI
 * @param {vscode.Uri[]} uris Multiple selected URIs
 */
async function handleExtractCode(context, uri, uris) {
    if (!uris || uris.length === 0) {
        uris = uri ? [uri] : [];
    }

    if (uris.length === 0) {
        vscode.window.showWarningMessage('No folders selected for extraction.');
        return;
    }

    // Get ignore patterns from settings
    const ignorePatterns = getEffectiveIgnorePatterns();
    console.log('Using ignore patterns for extraction:', ignorePatterns);

    const initialPromptMessage = context.globalState.get('initialPromptMessage', '');
    const extractedContent = await extractCode(uris, ignorePatterns);
    const combinedContent = initialPromptMessage + '\n\n' + extractedContent;

    // Update the clipboard with the combined content
    await vscode.env.clipboard.writeText(combinedContent);

    // Update the webview
    updateOrCreateWebview(context, extractedContent);

    // Show a success message
    vscode.window.showInformationMessage('Content extracted and copied to clipboard!');
}

/**
 * Handles the Remove Comments command
 * @param {vscode.Uri} uri Single selected URI
 * @param {vscode.Uri[]} uris Multiple selected URIs
 */
async function handleRemoveComments(uri, uris) {
    console.log('handleRemoveComments called with:', { uri: uri?.fsPath, uris: uris?.map(u => u.fsPath) });
    
    if (!uris || uris.length === 0) {
        uris = uri ? [uri] : [];
        console.log('Normalized uris:', uris.map(u => u.fsPath));
    }

    if (uris.length === 0) {
        vscode.window.showWarningMessage('No files or folders selected for comment removal.');
        return;
    }

    const proceed = await vscode.window.showWarningMessage(
        'This will permanently remove comments from the selected files. Are you sure you want to continue?',
        'Yes', 'No'
    );

    if (proceed === 'Yes') {
        console.log('Starting comment removal for:', uris.map(u => u.fsPath));
        
        // Get ignore patterns from settings
        const ignorePatterns = getEffectiveIgnorePatterns();
        console.log('Using ignore patterns for comment removal:', ignorePatterns);
        
        await removeComments(uris, ignorePatterns);
    } else {
        console.log('Comment removal cancelled by user');
    }
}

function handleOpenExplorer(context) {
    vscode.commands.executeCommand('workbench.view.explorer');
    showWebview(context);
}

function setupTreeView(context) {
    const emptyTreeDataProvider = {
        getTreeItem: () => null,
        getChildren: () => []
    };

    const treeView = vscode.window.createTreeView('emptyView', { treeDataProvider: emptyTreeDataProvider });

    treeView.onDidChangeVisibility(e => {
        if (e.visible) {
            vscode.commands.executeCommand('syntaxExtractor.openExplorer');
        }
    });

    context.subscriptions.push(treeView);
}

function updateOrCreateWebview(context, content) {
    if (currentPanel) {
        updateWebviewContent(content);
    } else {
        showWebview(context, () => updateWebviewContent(content));
    }
}

function updateWebviewContent(content) {
    if (currentPanel) {
        sendMessageToWebview('updateClipboard', { content });
        console.log('Updated existing webview with new content');
        
        // Calculate and update token count for clipboard content only
        const tokenCount = countTokens(content);
        sendMessageToWebview('updateTokenCount', { tokenCount });
    }
}

function countTokens(text) {
    if (!encoder) {
        console.error('Tiktoken encoder not initialized');
        return text.split(/\s+/).length;
    }
    return encoder.encode(text).length;
}

function showWebview(context, callback) {
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.One);
        if (callback) callback();
        return;
    }

    currentPanel = createWebviewPanel(context);
    setupWebviewMessageHandling(context, callback);
    updateClipboardContent();
}

function createWebviewPanel(context) {
    const panel = vscode.window.createWebviewPanel(
        'syntaxExtractorWebview',
        'Syntax Extractor View',
        vscode.ViewColumn.One,
        getWebviewOptions(context)
    );

    panel.webview.html = getWebviewContent(context, panel);

    panel.onDidDispose(() => {
        currentPanel = undefined;
        if (clipboardListener) {
            clipboardListener.dispose();
            clipboardListener = undefined;
        }
    });

    return panel;
}

function getWebviewOptions(context) {
    return {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview'))]
    };
}

function setupWebviewMessageHandling(context, callback) {
    currentPanel.webview.onDidReceiveMessage(message => {
        switch (message.command) {
            case 'webviewReady': {
                console.log('Webview is ready');
                const savedClipboardHeight = context.globalState.get('clipboardTextareaHeight', 200);
                const savedInitialPromptHeight = context.globalState.get('initialPromptTextareaHeight', 100);
                const savedInitialPromptMessage = context.globalState.get('initialPromptMessage', '');
                sendMessageToWebview('initializeWebview', { 
                    clipboardHeight: savedClipboardHeight,
                    initialPromptHeight: savedInitialPromptHeight,
                    initialPromptMessage: savedInitialPromptMessage
                });
                if (callback) callback();
                break;
            }
            case 'contentChanged': {
                const combinedText = message.initialPromptMessage + '\n\n' + message.clipboardContent;
                const tokenCount = countTokens(message.clipboardContent);
                sendMessageToWebview('updateTokenCount', { tokenCount });
                // Save the initial prompt message
                context.globalState.update('initialPromptMessage', message.initialPromptMessage);
                // Update clipboard with combined content
                vscode.env.clipboard.writeText(combinedText);
                break;
            }
            case 'textareaResized': {
                if (message.id === 'clipboardDataBox') {
                    context.globalState.update('clipboardTextareaHeight', message.height);
                } else if (message.id === 'initialPromptMessageBox') {
                    context.globalState.update('initialPromptTextareaHeight', message.height);
                }
                break;
            }
        }
    });
}

function sendMessageToWebview(command, data) {
    if (currentPanel) {
        currentPanel.webview.postMessage({ command, ...data });
    }
}

function getWebviewContent(context, panel) {
    const webview = panel.webview;
    const basePath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview'));
    const htmlPath = vscode.Uri.joinPath(basePath, 'webview.html');

    try {
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
        console.log(`Loaded HTML content from: ${htmlPath.fsPath}`);

        const cssFiles = ['variables.css', 'webview.css', 'box.css'];
        cssFiles.forEach(file => {
            const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(basePath, 'styles', file));
            htmlContent = htmlContent.replace(`./styles/${file}`, cssUri.toString());
        });

        return htmlContent;
    } catch (error) {
        console.error(`Error reading webview.html: ${error.message}`);
        return `<html><body><h1>Error loading webview content</h1><p>${error.message}</p></body></html>`;
    }
}

function setupClipboardListener() {
    if (clipboardListener) {
        clipboardListener.dispose();
    }

    clipboardListener = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.scheme === 'clipboard') {
            updateClipboardContent();
        }
    });
}

function updateClipboardContent() {
    if (currentPanel) {
        vscode.env.clipboard.readText().then(text => {
            sendMessageToWebview('updateClipboard', { content: text });
        });
    }
}

function deactivate() {
    if (clipboardListener) {
        clipboardListener.dispose();
    }
    if (encoder) {
        encoder.free();
    }
}

module.exports = { activate, deactivate };