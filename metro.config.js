const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Exclude Replit's internal directories from Metro's file watcher.
// Without this, Metro crashes with ENOENT when Replit rotates its log files
// inside .local/state/workflow-logs/ while Metro is watching them.
const escapeRegex = (s) => s.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
const root = escapeRegex(__dirname);

config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  new RegExp(`^${root}/\\.local/.*`),
  new RegExp(`^${root}/\\.git/.*`),
];

module.exports = config;
