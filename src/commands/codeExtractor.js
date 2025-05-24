const vscode = require('vscode');
const path = require('path');
const fs = require('fs').promises;
const { traverseDirectory, getFileContent } = require('../core/fileTraversal');
const { createHeader, findCommonBasePath } = require('../core/utils');
const { writeToClipboard, showInfoMessage, showErrorMessage } = require('../services/vscodeServices');
const { checkIsIgnored } = require('../core/ignoreHelper');

/**
 * Extracts code structure and content from selected files/folders
 * @param {vscode.Uri[]} uris Selected URIs
 * @param {string[]} ignorePatterns Patterns of files/folders to ignore
 * @returns {Promise<string>} The extracted content
 */
const extractCode = async (uris, ignorePatterns = []) => {
    if (!Array.isArray(uris) || uris.length === 0) return '';

    const selectedPaths = uris.map(uri => uri.fsPath);
    const basePath = findCommonBasePath(selectedPaths);
    console.log('True base path determined:', basePath);
    console.log('Using ignore patterns:', ignorePatterns);

    try {
        let combinedResult = {
            fileTypes: new Set(),
            files: new Set(),
            folderStructure: '',
            fileContents: ''
        };

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
                const result = await traverseDirectory(uri.fsPath, 0, basePath, ignorePatterns);
                mergeResults(combinedResult, result);
            } else if (stats.type === vscode.FileType.File) {
                const relativeFilePath = path.relative(basePath, uri.fsPath);
                const fileContent = await getFileContent(uri.fsPath, basePath, ignorePatterns);
                
                // Skip if the file was ignored (indicated by special message)
                if (fileContent.includes('[IGNORED BY PATTERN]')) {
                    continue;
                }
                
                combinedResult.files.add(relativeFilePath);

                // Determine if the file is binary based on the content format
                const isBinaryOrIgnored = fileContent.startsWith('\n---');
                if (!isBinaryOrIgnored) {
                    const ext = path.extname(uri.fsPath).slice(1).toLowerCase();
                    combinedResult.fileTypes.add(ext);
                }

                combinedResult.fileContents += fileContent;
                
                // Add file to folder structure
                const pathParts = relativeFilePath.split(path.sep);
                let currentPath = '';
                pathParts.forEach((part, index) => {
                    const isLast = index === pathParts.length - 1;
                    const indent = '  '.repeat(index);
                    currentPath = path.join(currentPath, part);
                    if (isLast) {
                        combinedResult.folderStructure += `${indent}└── ${part}\n`;
                    } else {
                        combinedResult.folderStructure += `${indent}├── ${part}/\n`;
                    }
                });
            }
        }

        const finalContent = formatFinalContent(combinedResult, basePath);

        await writeToClipboard(finalContent);
        showInfoMessage('Folder structure, file information, and contents copied to clipboard!');

        return finalContent;
    } catch (error) {
        console.error('Error in extractCode:', error);
        showErrorMessage(`An error occurred: ${error.message}`);
        return '';
    }
};

/**
 * Merges results from traversing directories
 * @param {Object} combinedResult The result object to merge into
 * @param {Object} result The result object to merge from
 */
const mergeResults = (combinedResult, result) => {
    result.fileTypes.forEach(type => combinedResult.fileTypes.add(type));
    result.files.forEach(file => combinedResult.files.add(file));
    combinedResult.folderStructure += result.folderStructure;
    combinedResult.fileContents += result.fileContents;
};

/**
 * Formats the final content string
 * @param {Object} combinedResult The combined result object
 * @param {string} basePath The common base path
 * @returns {string} The formatted content string
 */
const formatFinalContent = (combinedResult, basePath) => {
    const headerContent = createHeader(combinedResult.fileTypes);
    const folderStructureOutput = `\n${basePath}\n${combinedResult.folderStructure}`;
    return `${headerContent}\n\nFolder Structure:${folderStructureOutput}\n\nFile Contents:\n${combinedResult.fileContents}`;
};

module.exports = { extractCode };
