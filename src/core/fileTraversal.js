const fs = require('fs').promises;
const path = require('path');
const { isBinary } = require('istextorbinary');
const { checkIsIgnored } = require('./ignoreHelper');

/**
 * Traverses a directory recursively and extracts file structure and content
 * @param {string} dir The directory to traverse
 * @param {number} level Current indentation level for folder structure
 * @param {string} basePath Base path to calculate relative paths from
 * @param {string[]} ignorePatterns Patterns of files/folders to ignore
 * @returns {Object} Object containing folderStructure, fileTypes, files, and fileContents
 */
const traverseDirectory = async (dir, level = 0, basePath = '', ignorePatterns = []) => {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        let fileTypes = new Set(), files = new Set();
        let folderStructure = '', fileContents = '';

        const relativeDirPath = path.relative(basePath, dir);
        
        // Skip this directory if it matches an ignore pattern
        if (relativeDirPath && checkIsIgnored(
            relativeDirPath,
            path.basename(dir),
            true,
            ignorePatterns
        )) {
            console.log(`Ignoring directory: ${relativeDirPath}`);
            return { folderStructure, fileTypes, files, fileContents };
        }

        // Add directory to folder structure if it's not the base directory
        if (relativeDirPath) {
            const dirParts = relativeDirPath.split(path.sep);
            const indent = '  '.repeat(level);  // Use the current level for indentation

            folderStructure += `${indent}└── ${dirParts[dirParts.length - 1]}/\n`; // Add only the last part of the path
            level++;  // Increment level for subdirectories
        }

        const sortedEntries = entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < sortedEntries.length; i++) {
            const entry = sortedEntries[i];
            const entryPath = path.join(dir, entry.name);
            const entryRelativePath = path.relative(basePath, entryPath);
            const indent = '  '.repeat(level);
            const isLast = i === sortedEntries.length - 1;
            const prefix = isLast ? '└── ' : '├── ';

            // Check if the entry should be ignored
            if (checkIsIgnored(
                entryRelativePath,
                entry.name,
                entry.isDirectory(),
                ignorePatterns
            )) {
                console.log(`Ignoring: ${entryRelativePath}`);
                continue;
            }

            if (entry.isDirectory()) {
                const subResult = await traverseDirectory(entryPath, level, basePath, ignorePatterns);
                mergeResults(fileTypes, files, subResult);
                folderStructure += subResult.folderStructure;
                fileContents += subResult.fileContents;
            } else {
                files.add(entryRelativePath);
                folderStructure += `${indent}${prefix}${entry.name}\n`;

                const ext = path.extname(entry.name).toLowerCase().slice(1);
                if (ext) fileTypes.add(ext);

                fileContents += await getFileContent(entryPath, basePath, ignorePatterns);
            }
        }

        return { folderStructure, fileTypes, files, fileContents };
    } catch (error) {
        console.error(`Error traversing directory ${dir}:`, error);
        return { 
            folderStructure: `Error traversing directory: ${error.message}\n`, 
            fileTypes: new Set(), 
            files: new Set(), 
            fileContents: '' 
        };
    }
};

/**
 * Gets the content of a file with consideration for ignore patterns
 * @param {string} filePath Path to the file
 * @param {string} basePath Base path to calculate relative paths from
 * @param {string[]} ignorePatterns Patterns of files to ignore
 * @returns {string} File content or ignore indicator
 */
const getFileContent = async (filePath, basePath, ignorePatterns = []) => {
    try {
        const relativeFilePath = path.relative(basePath, filePath);
        const fileName = path.basename(filePath);
        
        // Check if this file should be ignored
        if (checkIsIgnored(relativeFilePath, fileName, false, ignorePatterns)) {
            console.log(`Ignoring file: ${relativeFilePath}`);
            return `\n--- ${relativeFilePath} [IGNORED BY PATTERN] \n`;
        }

        const buffer = await fs.readFile(filePath);

        // Pass the filePath to isBinary for accurate detection based on file extension
        if (!isBinary(filePath, buffer)) {
            let content;
            try {
                content = buffer.toString('utf8');
            } catch (error) {
                console.warn(`Error decoding file as UTF-8: ${filePath}`, error);
                content = buffer.toString('latin1');  // Fallback to Latin-1 encoding
            }
            return `\n-${relativeFilePath}-\n${content.trimEnd()}\n`;
        } else {
            return `\n--- ${relativeFilePath} [BINARY FILE] \n`;
        }
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        return `\n-${filePath}-\nError reading file: ${error.message}\n`;
    }
};

/**
 * Merges file type and file sets from subresults
 * @param {Set} fileTypes Set to merge file types into
 * @param {Set} files Set to merge files into
 * @param {Object} result Result object with fileTypes and files to merge
 */
const mergeResults = (fileTypes, files, result) => {
    result.fileTypes.forEach(type => fileTypes.add(type));
    result.files.forEach(file => files.add(file));
};

module.exports = { traverseDirectory, getFileContent };
