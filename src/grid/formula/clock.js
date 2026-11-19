// The page's clock and random source, the engine's defaults for TODAY, NOW, RAND and RANDBETWEEN.
// The only file of the formula engine that reads either; a host or a test passes its own.

// Now as a serial day in local time, the time of day as a fraction.
export const systemNow = () => {
  const now = new Date();
  return (now.getTime() - now.getTimezoneOffset() * 60000) / 86400000 + 25569;
};

export const systemRandom = () => Math.random();
