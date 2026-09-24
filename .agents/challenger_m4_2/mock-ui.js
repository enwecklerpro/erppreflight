// Mock UI primitive for headless testing
const dummy = () => null;
module.exports = new Proxy({}, {
  get: (target, prop) => {
    if (prop === '__esModule') return true;
    if (prop === 'default') return dummy;
    return dummy;
  }
});
