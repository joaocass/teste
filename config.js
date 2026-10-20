module.exports = {
  siteName: process.env.SITE_NAME || 'Observatório das Pesquisas',
  port: process.env.PORT || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'observatorio',
  // Se MONGODB_URI não estiver definido e o Mongo não responder, usa data/polls.json (apenas desenvolvimento)
  allowFileFallback: process.env.NO_FILE_FALLBACK ? false : true
};
