const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const { showInfoMessage, showErrorMessage } = require('../services/vscodeServices');
const tiktoken = require('tiktoken');
const { checkIsIgnored } = require('../core/ignoreHelper');
const { findCommonBasePath } = require('../core/utils');

/**
 * Removes comments from selected files/folders
 * @param {vscode.Uri[]} uris Selected URIs
 * @param {string[]} ignorePatterns Patterns of files/folders to ignore
 * @returns {Promise<void>}
 */
const removeComments = async (uris, ignorePatterns = []) => {
    if (!Array.isArray(uris) || uris.length === 0) return;

    try {
        let filesProcessed = 0;
        let totalCharactersRemoved = 0;
        let totalTokensRemoved = 0;
        const encoder = tiktoken.get_encoding("cl100k_base");
        
        // Determine the common base path for relative path calculations
        const selectedPaths = uris.map(uri => uri.fsPath);
        const basePath = findCommonBasePath(selectedPaths);
        console.log('Base path for ignore checks:', basePath);
        console.log('Using ignore patterns:', ignorePatterns);

        for (const uri of uris) {
            const stats = await vscode.workspace.fs.stat(uri);
            const relativePath = path.relative(basePath, uri.fsPath);
            const fileName = path.basename(uri.fsPath);
            
            // Check if this URI should be ignored
            if (relativePath && checkIsIgnored(
                relativePath,
                fileName,
                stats.type === vscode.FileType.Directory,
                ignorePatterns
            )) {
                console.log(`Ignoring selected item: ${relativePath}`);
                continue;
            }
            
            if (stats.type === vscode.FileType.Directory) {
                const result = await processDirectory(uri.fsPath, encoder, basePath, ignorePatterns);
                filesProcessed += result.filesProcessed;
                totalCharactersRemoved += result.charactersRemoved;
                totalTokensRemoved += result.tokensRemoved;
            } else if (stats.type === vscode.FileType.File) {
                const result = await processFile(uri.fsPath, encoder, basePath, ignorePatterns);
                if (result.processed) {
                    filesProcessed++;
                    totalCharactersRemoved += result.charactersRemoved;
                    totalTokensRemoved += result.tokensRemoved;
                }
            }
        }

        encoder.free();
        
        if (filesProcessed > 0) {
            showInfoMessage(
                `Removed ${totalCharactersRemoved} chars (${totalTokensRemoved} tokens) from ${filesProcessed} files`
            );
        } else {
            showInfoMessage('No comments found to remove');
        }
    } catch (error) {
        console.error('Error in removeComments:', error);
        showErrorMessage(`An error occurred: ${error.message}`);
    }
};

/**
 * Processes a directory for comment removal with ignore pattern support
 * @param {string} dirPath Path to the directory
 * @param {Object} encoder Tiktoken encoder instance
 * @param {string} basePath Base path for relative path calculations
 * @param {string[]} ignorePatterns Patterns of files/folders to ignore
 * @returns {Object} Processing results
 */
const processDirectory = async (dirPath, encoder, basePath, ignorePatterns = []) => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        let filesProcessed = 0;
        let charactersRemoved = 0;
        let tokensRemoved = 0;

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(basePath, fullPath);
            
            // Check if this entry should be ignored
            if (checkIsIgnored(
                relativePath,
                entry.name,
                entry.isDirectory(),
                ignorePatterns
            )) {
                console.log(`Ignoring: ${relativePath}`);
                continue;
            }
            
            if (entry.isDirectory()) {
                const result = await processDirectory(fullPath, encoder, basePath, ignorePatterns);
                filesProcessed += result.filesProcessed;
                charactersRemoved += result.charactersRemoved;
                tokensRemoved += result.tokensRemoved;
            } else if (entry.isFile()) {
                const result = await processFile(fullPath, encoder, basePath, ignorePatterns);
                if (result.processed) {
                    filesProcessed++;
                    charactersRemoved += result.charactersRemoved;
                    tokensRemoved += result.tokensRemoved;
                }
            }
        }

        return { filesProcessed, charactersRemoved, tokensRemoved };
    } catch (error) {
        console.error(`Error processing directory ${dirPath}:`, error);
        return { filesProcessed: 0, charactersRemoved: 0, tokensRemoved: 0 };
    }
};

/**
 * Processes a file for comment removal with ignore pattern support
 * @param {string} filePath Path to the file
 * @param {Object} encoder Tiktoken encoder instance
 * @param {string} basePath Base path for relative path calculations
 * @param {string[]} ignorePatterns Patterns of files to ignore
 * @returns {Object} Processing results
 */
const processFile = async (filePath, encoder, basePath, ignorePatterns = []) => {
    try {
        const ext = path.extname(filePath).toLowerCase();
        const relativePath = path.relative(basePath, filePath);
        const fileName = path.basename(filePath);
        
        console.log(`Processing file: ${relativePath} with extension: ${ext}`);
        
        // Check if this file should be ignored
        if (checkIsIgnored(relativePath, fileName, false, ignorePatterns)) {
            console.log(`Ignoring file: ${relativePath}`);
            return { processed: false, charactersRemoved: 0, tokensRemoved: 0 };
        }
        
        if (!isSupportedFileType(ext)) {
            console.log(`File type ${ext} not supported`);
            return { processed: false, charactersRemoved: 0, tokensRemoved: 0 };
        }

        const content = await fs.readFile(filePath, 'utf8');
        const originalLength = content.length;
        const originalTokens = encoder.encode(content).length;
        
        const cleanedContent = removeCommentsFromContent(content, ext);
        const newLength = cleanedContent.length;
        const newTokens = encoder.encode(cleanedContent).length;
        
        if (content !== cleanedContent) {
            console.log(`Changes detected, saving file: ${relativePath}`);
            await fs.writeFile(filePath, cleanedContent, 'utf8');
            return {
                processed: true,
                charactersRemoved: originalLength - newLength,
                tokensRemoved: originalTokens - newTokens
            };
        }
        
        console.log(`No changes needed for file: ${relativePath}`);
        return { processed: false, charactersRemoved: 0, tokensRemoved: 0 };
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error);
        return { processed: false, charactersRemoved: 0, tokensRemoved: 0 };
    }
};

const isSupportedFileType = (ext) => {
    return Object.prototype.hasOwnProperty.call(COMMENT_PATTERNS, ext);
};

const COMMENT_PATTERNS = {
    '.js': { single: '//', multi: ['/*', '*/'] },
    '.jsx': { single: '//', multi: ['/*', '*/'] },
    '.ts': { single: '//', multi: ['/*', '*/'] },
    '.tsx': { single: '//', multi: ['/*', '*/'] },
    '.py': { single: '#', multi: ['"""', '"""', "'''", "'''"] },
    '.java': { single: '//', multi: ['/*', '*/'] },
    '.c': { single: '//', multi: ['/*', '*/'] },
    '.cpp': { single: '//', multi: ['/*', '*/'] },
    '.h': { single: '//', multi: ['/*', '*/'] },
    '.hpp': { single: '//', multi: ['/*', '*/'] },
    '.cs': { single: '//', multi: ['/*', '*/'] },
    '.go': { single: '//', multi: ['/*', '*/'] },
    '.rb': { single: '#', multi: ['=begin', '=end'] },
    '.php': { single: '//', multi: ['/*', '*/'] },
    '.swift': { single: '//', multi: ['/*', '*/'] },
    '.rs': { single: '//', multi: ['/*', '*/'] },
    '.kt': { single: '//', multi: ['/*', '*/'] },
    '.kts': { single: '//', multi: ['/*', '*/'] },
    '.scala': { single: '//', multi: ['/*', '*/'] },
    '.html': { multi: ['<!--', '-->'] },
    '.htm': { multi: ['<!--', '-->'] },
    '.xml': { multi: ['<!--', '-->'] },
    '.svg': { multi: ['<!--', '-->'] },
    '.vue': { single: '//', multi: ['<!--', '-->', '/*', '*/'] },
    '.css': { multi: ['/*', '*/'] },
    '.scss': { single: '//', multi: ['/*', '*/'] },
    '.less': { single: '//', multi: ['/*', '*/'] }
};

const removeCommentsFromContent = (content, ext) => {
    const patterns = COMMENT_PATTERNS[ext];
    if (!patterns) return content;

    let result = content;

    // Special handling for HTML files which may contain JS and CSS
    if (ext === '.html' || ext === '.htm') {
        // Process different sections separately
        result = result.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (match, openTag, content, closeTag) => {
            // Remove JS-style comments from script tags
            let cleaned = content.replace(/\/\/.*$/gm, '')  // Single-line JS comments
                                .replace(/\/\*[\s\S]*?\*\//g, ''); // Multi-line JS comments
            return openTag + cleaned + closeTag;
        });

        result = result.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, openTag, content, closeTag) => {
            // Remove CSS-style comments from style tags
            let cleaned = content.replace(/\/\*[\s\S]*?\*\//g, ''); // CSS comments
            return openTag + cleaned + closeTag;
        });

        // Remove HTML comments last
        result = result.replace(/<!--[\s\S]*?-->/g, '');
    } else {
        // Normal processing for non-HTML files
        // Remove single-line comments
        if (patterns.single) {
            const singleLineRegex = new RegExp(`${escapeRegExp(patterns.single)}.*$`, 'gm');
            result = result.replace(singleLineRegex, '');
        }

        // Remove multi-line comments
        if (patterns.multi) {
            for (let i = 0; i < patterns.multi.length; i += 2) {
                const start = escapeRegExp(patterns.multi[i]);
                const end = escapeRegExp(patterns.multi[i + 1]);
                const multiLineRegex = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
                result = result.replace(multiLineRegex, '');
            }
        }
    }

    // Clean up whitespace
    result = result.replace(/^\s*[\r\n]/gm, '')         // Remove empty lines
                  .replace(/\s+$/gm, '')                // Remove trailing whitespace
                  .replace(/[\r\n]{3,}/g, '\n\n')      // Reduce multiple blank lines to max two
                  .replace(/[ \t]+$/gm, '');           // Remove trailing spaces/tabs

    return result;
};

const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = { removeComments }; 