const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

// Monorepo setup: Metro must watch the workspace root so it can bundle the
// shared packages/* sources, and resolve modules from the hoisted root
// node_modules as well as the app's own.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
