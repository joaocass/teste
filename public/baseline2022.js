/* ==========================================================================
   Resultado oficial do 2º turno de 2022 (votos válidos), por estado.
   Fonte dos percentuais: seedData.js original do projeto (TSE, 2º turno).
   lula2022 = % de Lula no estado | bolsonaro2022 = % de Bolsonaro (pai) no estado
   weight   = peso do estado no total de votos válidos nacionais de 2022
   ========================================================================== */
const BASELINE_2022 = {
  SP:{lula:44.76,bolsonaro:55.24,weight:0.216072},
  MG:{lula:50.20,bolsonaro:49.80,weight:0.103766},
  RJ:{lula:43.47,bolsonaro:56.53,weight:0.081444},
  ES:{lula:41.96,bolsonaro:58.04,weight:0.018944},

  BA:{lula:72.12,bolsonaro:27.88,weight:0.071718},
  PE:{lula:66.93,bolsonaro:33.07,weight:0.045783},
  CE:{lula:69.97,bolsonaro:30.03,weight:0.044330},
  MA:{lula:71.14,bolsonaro:28.86,weight:0.032857},
  PB:{lula:66.62,bolsonaro:33.38,weight:0.020571},
  PI:{lula:76.86,bolsonaro:23.14,weight:0.017154},
  RN:{lula:65.10,bolsonaro:34.90,weight:0.016852},
  AL:{lula:58.68,bolsonaro:41.32,weight:0.015470},
  SE:{lula:67.21,bolsonaro:32.79,weight:0.011025},

  PR:{lula:37.60,bolsonaro:62.40,weight:0.054546},
  RS:{lula:43.65,bolsonaro:56.35,weight:0.054021},
  SC:{lula:30.73,bolsonaro:69.27,weight:0.036275},

  PA:{lula:54.75,bolsonaro:45.25,weight:0.039684},
  AM:{lula:51.10,bolsonaro:48.90,weight:0.017744},
  RO:{lula:29.34,bolsonaro:70.66,weight:0.008027},
  TO:{lula:51.36,bolsonaro:48.64,weight:0.007489},
  AC:{lula:29.70,bolsonaro:70.30,weight:0.003891},
  AP:{lula:48.64,bolsonaro:51.36,weight:0.003659},
  RR:{lula:23.92,bolsonaro:76.08,weight:0.002544},

  GO:{lula:41.29,bolsonaro:58.71,weight:0.032188},
  MT:{lula:34.92,bolsonaro:65.08,weight:0.016717},
  DF:{lula:41.19,bolsonaro:58.81,weight:0.014271},
  MS:{lula:40.51,bolsonaro:59.49,weight:0.012827}
};

/* Regiões oficiais do IBGE, usadas para os insights regionais. */
const REGIONS = {
  Norte:        ['AC','AP','AM','PA','RO','RR','TO'],
  Nordeste:     ['AL','BA','CE','MA','PB','PE','PI','RN','SE'],
  'Centro-Oeste': ['DF','GO','MT','MS'],
  Sudeste:      ['ES','MG','RJ','SP'],
  Sul:          ['PR','RS','SC']
};
const REGION_ORDER = ['Norte','Nordeste','Centro-Oeste','Sudeste','Sul'];
const REGION_OF = {};
Object.entries(REGIONS).forEach(([r, list]) => list.forEach(uf => { REGION_OF[uf] = r; }));

