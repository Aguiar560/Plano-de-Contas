/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 15000,          // operações de DB podem demorar um pouco
  forceExit: true,             // encerra mesmo com conexões MySQL/handles abertos
  detectOpenHandles: true,     // reporta o que está impedindo o encerramento
  // Silenciar console.log do server durante os testes
  silent: false,
  // Cobertura
  collectCoverageFrom: [
    'server.js',
    'db.js',
    '!node_modules/**',
    '!__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
};
