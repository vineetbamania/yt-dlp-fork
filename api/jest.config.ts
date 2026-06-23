import type { Config } from 'jest';

const config: Config = {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    './convert/': {
      branches: 65,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },
};

export default config;
