const vscode = require('vscode');
const path = require('path');

// Handle different versions of minimatch
let minimatchFn;
try {
    // Try importing as a function (for older versions)
    minimatchFn = require('minimatch');
    // If it's an object with a minimatch property (newer versions)
    if (typeof minimatchFn === 'object' && typeof minimatchFn.minimatch === 'function') {
        minimatchFn = minimatchFn.minimatch;
    }
    console.log('Minimatch import type:', typeof minimatchFn);
} catch (err) {
    console.error('Error importing minimatch:', err);
    // Fallback - define a simple function that returns false (never matches)
    minimatchFn = () => false;
}

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
 * Takes into account the master enable/disable switch
 * @returns {string[]} An array of effective ignore patterns, or an empty array if ignore processing is disabled
 */
function getEffectiveIgnorePatterns() {
    try {
        const config = vscode.workspace.getConfiguration('syntaxExtractor');
        
        // Check the master enable/disable switch first
        const enableIgnoreProcessing = config.get('enableIgnoreProcessing', true);
        
        // If ignore processing is disabled, return an empty array to bypass all ignore checks
        if (!enableIgnoreProcessing) {
            console.log('Ignore processing is globally disabled');
            return [];
        }
        
        // Get user-defined patterns
        const userPatternsString = config.get('ignorePatterns', '');
        const userPatterns = userPatternsString
            .split(',')
            .map(pattern => pattern.trim())
            .filter(pattern => pattern.length > 0);
        
        // Determine if default patterns should be included
        const useDefaultPatterns = config.get('useDefaultIgnorePatterns', true);
        
        // Combine patterns if necessary
        const effectivePatterns = useDefaultPatterns 
            ? [...DEFAULT_IGNORE_PATTERNS, ...userPatterns]
            : userPatterns;
        
        console.log('Effective ignore patterns:', effectivePatterns);
        return effectivePatterns;
    } catch (error) {
        console.error('Error in getEffectiveIgnorePatterns:', error);
        // Return empty array as fallback to avoid blocking the main functionality
        return [];
    }
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
    try {
        // Early return if no patterns are provided or if the pattern array is empty
        // This also handles the case when ignore processing is globally disabled
        // (getEffectiveIgnorePatterns will return an empty array)
        if (!ignorePatterns || ignorePatterns.length === 0) {
            return false;
        }

        // Verify minimatch is available
        if (typeof minimatchFn !== 'function') {
            console.error('minimatch is not a function, using fallback behavior');
            return false;
        }

        // Normalize paths for consistent matching
        const normalizedPath = normalizePath(itemRelativePath);
        const normalizedName = normalizePath(itemName);

        // For directories, add trailing slash if not already present
        const pathForDirCheck = isDirectory && !normalizedPath.endsWith('/') 
            ? `${normalizedPath}/` 
            : normalizedPath;
        
        // Log the paths we're checking against patterns (only in debug scenarios)
        // console.log(`Checking if ${pathForDirCheck} matches any patterns`);
        
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
            try {
                if (minimatchFn(normalizedName, normalizedPattern, { dot: true })) {
                    // console.log(`${normalizedName} matched pattern ${normalizedPattern}`);
                    return true;
                }
            } catch (err) {
                console.error(`Error matching pattern ${normalizedPattern} against ${normalizedName}:`, err);
            }

            // Check if the full relative path matches the pattern
            // This handles nested patterns like "build/**" or "src/test/*.spec.js"
            try {
                const result = minimatchFn(pathForDirCheck, normalizedPattern, { dot: true });
                // if (result) {
                //     console.log(`${pathForDirCheck} matched pattern ${normalizedPattern}`);
                // }
                return result;
            } catch (err) {
                console.error(`Error matching pattern ${normalizedPattern} against ${pathForDirCheck}:`, err);
                return false;
            }
        });
    } catch (error) {
        console.error('Error in checkIsIgnored:', error);
        // Return false as fallback to avoid blocking the main functionality
        // This means we won't ignore files if there's an error
        return false;
    }
}

module.exports = {
    DEFAULT_IGNORE_PATTERNS,
    getEffectiveIgnorePatterns,
    checkIsIgnored,
    normalizePath
};