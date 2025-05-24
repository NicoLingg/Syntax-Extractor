/**
 * This is a utility script to verify that minimatch is working correctly
 * Run it with: node src/core/check-minimatch.js
 */

try {
    console.log('Checking minimatch installation...');
    
    // Try to require minimatch
    const minimatchModule = require('minimatch');
    console.log('minimatch module type:', typeof minimatchModule);
    
    // Check if it's an object with a minimatch function property (newer versions)
    if (typeof minimatchModule === 'object' && typeof minimatchModule.minimatch === 'function') {
        console.log('minimatch is an object with a minimatch function property (v9+ format)');
        const result = minimatchModule.minimatch('test.js', '*.js');
        console.log('Test result (should be true):', result);
    } 
    // Check if it's a function directly (older versions)
    else if (typeof minimatchModule === 'function') {
        console.log('minimatch is a function directly (pre-v9 format)');
        const result = minimatchModule('test.js', '*.js');
        console.log('Test result (should be true):', result);
    }
    // Neither format works
    else {
        console.error('ERROR: minimatch is neither a function nor an object with a minimatch function property');
        console.error('Type of minimatchModule:', typeof minimatchModule);
        console.error('Content of minimatchModule:', JSON.stringify(minimatchModule, null, 2));
    }
    
    console.log('minimatch version:', require('minimatch/package.json').version);
    console.log('All checks completed.');
} catch (error) {
    console.error('Error checking minimatch:', error);
}