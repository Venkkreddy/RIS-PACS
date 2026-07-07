// Test environment setup — runs before every test file is loaded.
// Ensures dev-mode auth bypass and in-memory store for isolated unit tests.
process.env.ENABLE_AUTH = "false";
process.env.NODE_ENV = "test";
process.env.HIPAA_AUDIT_ENABLED = "false";
process.env.USE_INMEMORY_STORE = "true";
