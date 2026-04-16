import type { Config } from 'jest'

const config: Config = {
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      // lib and types tests use Node.js APIs (child_process, fs, os) -- must stay in node.
      testMatch: ['**/app/api/**/*.test.ts', '**/lib/**/*.test.ts', '**/types/**/*.test.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['**/components/**/*.test.tsx'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    },
  ],
}

export default config
