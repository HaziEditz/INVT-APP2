const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'react-native-maps') {
    return {
      filePath: path.resolve(__dirname, 'stubs/react-native-maps.web.js'),
      type: 'sourceFile',
    };
  }
  // Ensure Firebase Auth resolves to the React Native build (persistence / getReactNativePersistence).
  if (
    (platform === 'android' || platform === 'ios') &&
    (moduleName === '@firebase/auth' || moduleName === 'firebase/auth')
  ) {
    const rnAuthPath = path.resolve(
      __dirname,
      'node_modules/@firebase/auth/dist/rn/index.js',
    );
    return { filePath: rnAuthPath, type: 'sourceFile' };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
