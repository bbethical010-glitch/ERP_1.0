export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const payload = {
    error: err.message || 'Internal Server Error'
  };

  if (err.details) {
    payload.details = err.details;
  }

  res.status(status).json(payload);
}
