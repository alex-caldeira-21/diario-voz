// setup(): idempotente. Pode ser rodado quantas vezes quiser no editor.
// Cria só o que falta; nunca apaga nem sobrescreve nada que já existe.

function setup() {
  const feito = [];
  const falta = [];

  // Planilha
  let sheetId = PROPS.getProperty('SHEET_ID');
  let planilha;
  if (!sheetId) {
    planilha = SpreadsheetApp.create('diario-voz');
    const sh = planilha.getSheets()[0];
    sh.setName(ABA);
    prepararAba_(sh);
    sheetId = planilha.getId();
    PROPS.setProperty('SHEET_ID', sheetId);
    feito.push('planilha criada');
  } else {
    planilha = SpreadsheetApp.openById(sheetId);
    if (!planilha.getSheetByName(ABA)) {
      prepararAba_(planilha.insertSheet(ABA));
      feito.push('aba "' + ABA + '" criada');
    }
  }

  // Token e modelo
  if (!PROPS.getProperty('APP_TOKEN')) {
    PROPS.setProperty('APP_TOKEN', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
    feito.push('APP_TOKEN criado');
  }
  if (!PROPS.getProperty('MODELO')) {
    PROPS.setProperty('MODELO', MODELO_PADRAO);
    feito.push('MODELO = ' + MODELO_PADRAO);
  }

  // Gatilho de reclassificação a cada 6 horas
  const temGatilho = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'gatilhoReclassificar';
  });
  if (!temGatilho) {
    ScriptApp.newTrigger('gatilhoReclassificar').timeBased().everyHours(6).create();
    feito.push('gatilho de reclassificação (6 h) criado');
  }

  if (!PROPS.getProperty('ANTHROPIC_KEY')) {
    falta.push('ANTHROPIC_KEY (Configurações do projeto > Propriedades do script)');
  }

  Logger.log('Planilha: ' + planilha.getUrl());
  Logger.log('APP_TOKEN: ' + PROPS.getProperty('APP_TOKEN'));
  Logger.log('MODELO: ' + PROPS.getProperty('MODELO'));
  Logger.log('Feito agora: ' + (feito.length ? feito.join('; ') : 'nada, já estava tudo pronto'));
  Logger.log('Falta: ' + (falta.length ? falta.join('; ') : 'nada'));
}

function prepararAba_(sh) {
  // Tudo como texto puro: datas ISO, ids e textos não são convertidos pelo Sheets.
  sh.getRange(1, 1, sh.getMaxRows(), CABECALHO.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(1, COL.texto, sh.getMaxRows(), 1).setWrap(true);
  sh.setColumnWidth(COL.texto, 480);
}
