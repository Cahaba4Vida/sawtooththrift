function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async () => {
  return json(200, {
    ok: true,
    service: 'sawtooththrift-functions',
    timestamp: new Date().toISOString(),
  });
};
