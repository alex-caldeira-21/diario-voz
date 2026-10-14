# diario-voz

Diário por voz e "segunda memória" pessoal. Especificação completa em [SPEC.md](SPEC.md).

## Apps Script

- Projeto: `diario-voz` (scriptId em [.clasp.json](.clasp.json))
- **deploymentId do web app:** `AKfycbwc9HYvopw6fVH0EK8MbPD7d7QFj15rZU5stIMdRDRb3uPfaTL90NV2QUtiXnmq8ls`
- URL: `https://script.google.com/macros/s/AKfycbwc9HYvopw6fVH0EK8MbPD7d7QFj15rZU5stIMdRDRb3uPfaTL90NV2QUtiXnmq8ls/exec`

Para publicar mudanças no código **sem mudar a URL** (o app no celular a guarda):

```bash
clasp push
clasp create-deployment --deploymentId AKfycbwc9HYvopw6fVH0EK8MbPD7d7QFj15rZU5stIMdRDRb3uPfaTL90NV2QUtiXnmq8ls --description "o que mudou"
```

Nunca crie um deployment novo sem `--deploymentId`.
