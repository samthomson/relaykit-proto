import express from 'express';

const app = express();
const PORT = process.env.PORT || 4000;

app.get('/', (req, res) => {
  res.send('<h1>RelayKit</h1><p>Backend running</p>');
});

app.listen(PORT, () => {
  console.log(`RelayKit backend running on port ${PORT}`);
});

