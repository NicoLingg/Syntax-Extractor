const vscode = require('vscode');
const path = require('path');
const minimatch = require('minimatch');

// Default patterns to ignore (primarily targeting development artifacts and VCS)
const DEFAULT_IGNORE_PATTERNS = [
    '.git/',
    'node_modules/',
    '__pycache__/',
    '.vscode/',
    '.idea/',
    '.vs/',
    '.DS_Store',
    'Thumbs.db',
    '*.swp',
    '*.swo',
    '*.pyc',
    '*.pyo',
    '*.class',
    'yarn-error.log',
    'npm-debug.log',
    '.env'
];

/**
 * Gets the effective ignore patterns by combining user-defined and default patterns
 * @returns {string[]} An array of effective ignore patterns
 */
function getEffectiveIgnorePatterns() {
    const config = vscode.workspace.getConfiguration('syntaxExtractor');
    
    // Get user-defined patterns
    const userPatternsString = config.get('ignorePatterns', '');
    const userPatterns = userPatternsString
        .split(',')
        .map(pattern => pattern.trim())
        .filter(pattern => pattern.length > 0);
    
    // Determine if default patterns should be included
    const useDefaultPatterns = config.get('useDefaultIgnorePatterns', true);
    
    // Combine patterns if necessary
    return useDefaultPatterns 
        ? [...DEFAULT_IGNORE_PATTERNS, ...userPatterns]
        : userPatterns;
}

/**
 * Normalizes a path for consistent cross-platform matching
 * @param {string} itemPath The path to normalize
 * @returns {string} The normalized path
 */
function normalizePath(itemPath) {
    // Convert backslashes to forward slashes for consistent matching
    return itemPath.replace(/\\/g, '/');
}

/**
 * Checks if a file or directory should be ignored based on patterns
 * @param {string} itemRelativePath Path relative to common base path
 * @param {string} itemName Basename of the file or folder
 * @param {boolean} isDirectory Whether the item is a directory
 * @param {string[]} ignorePatterns Array of glob patterns to check against
 * @returns {boolean} True if the item should be ignored, false otherwise
 */
function checkIsIgnored(itemRelativePath, itemName, isDirectory, ignorePatterns) {
    if (!ignorePatterns || ignorePatterns.length === 0) {
        return false;
    }

    // Normalize paths for consistent matching
    const normalizedPath = normalizePath(itemRelativePath);
    const normalizedName = normalizePath(itemName);

    // For directories, add trailing slash if not already present
    const pathForDirCheck = isDirectory && !normalizedPath.endsWith('/') 
        ? `${normalizedPath}/` 
        : normalizedPath;
    
    // Check if the item matches any ignore pattern
    return ignorePatterns.some(pattern => {
        // Normalize the pattern
        const normalizedPattern = normalizePath(pattern);
        
        // Check if the pattern is specifically for directories
        const isDirPattern = normalizedPattern.endsWith('/');
        
        // Skip directory-specific patterns if this is a file
        if (isDirPattern && !isDirectory) {
            return false;
        }

        // Check if the item name matches a simple pattern
        // This handles cases like "*.js" or ".DS_Store"
        if (minimatch(normalizedName, normalizedPattern, { dot: true })) {
            return true;
        }

        // Check if the full relative path matches the pattern
        // This handles nested patterns like "build/**" or "src/test/*.spec.js"
        return minimatch(pathForDirCheck, normalizedPattern, { dot: true });
    });
}

module.exports = {
    DEFAULT_IGNORE_PATTERNS,
    getEffectiveIgnorePatterns,
    checkIsIgnored,
    normalizePath
};