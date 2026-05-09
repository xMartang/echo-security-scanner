import { createDefaultEsmPreset } from 'ts-jest';

const preset = createDefaultEsmPreset({
  tsconfig: 'tsconfig.json',
});

/** @type {import('jest').Config} */
export default {
  ...preset,
  testEnvironment: 'node',
  moduleNameMapper: {
    // Strip .js suffix from @/ alias imports so Jest can find the TS source
    '^@/(.*)\\.js$': '<rootDir>/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Strip .js from relative imports
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  testTimeout: 30000,
};
