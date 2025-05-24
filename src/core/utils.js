const path = require('path');

/**
 * Finds the common base path among a list of paths
 * @param {string[]} paths Array of file/directory paths
 * @returns {string} The common base path
 */
function findCommonBasePath(paths) {
    if (paths.length === 0) return '';
    
    const splitPaths = paths.map(p => p.split(path.sep));
    const minLength = Math.min(...splitPaths.map(p => p.length));
    
    let commonBaseParts = [];
    
    for (let i = 0; i < minLength; i++) {
        const currentPart = splitPaths[0][i];
        if (splitPaths.every(parts => parts[i] === currentPart)) {
            commonBaseParts.push(currentPart);
        } else {
            break;
        }
    }

    return commonBaseParts.join(path.sep);
}

module.exports = {
    createHeader: (fileTypes) => {
        return `File types: ${Array.from(fileTypes).sort().join(', ')}`;
    },
    findCommonBasePath
};