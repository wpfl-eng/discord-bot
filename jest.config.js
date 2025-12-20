/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/tests/**/*.test.js', '**/tests/**/*.test.ts'],
  transform: { '^.+\\.(js|ts)$': 'babel-jest' },
  transformIgnorePatterns: ['node_modules/(?!(node-fetch)/)'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};
