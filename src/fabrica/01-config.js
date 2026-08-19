    /* =====================================================================
     * CONFIG
     * =================================================================== */
    var CONFIG = {
        storageKey: 'tec_fabrica_estado_v1',
        delayMin: 3500,
        delayMax: 6500,
        pollInterval: 400,
        loadTimeout: 20000,
        filtroTimeout: 15000,
        batchSize: 20,
        coletarAposCriar: true,
        autoContinuarLote: false,
        modoCriacao: 'padrao', // 'padrao' | 'criar-tudo' (cria todos os cadernos antes de coletar)
        banks: ['FCC', 'Fundatec', 'Vunesp', 'Cesgranrio', 'FGV', 'Legalle', 'Fundação La Salle', 'Instituto AOCP', 'Objetiva',
            'CEBRASPE', 'IBFC', 'Instituto Consulplan', 'QUADRIX', 'IDECAN', 'FEPESE', 'FAURGS'],
        years: [2023, 2020, 2022, 2018, 2025, 2021, 2017, 2024, 2019, 2026, 2016],
        removeCancelled: true,
        removeOutdated: true,
        usarCliqueGabarito: false,
        modoOperacao: 'stealth-offline',
        modoColeta: 'stealth-offline',
        perfilStealth: 'ultra-furtivo',
        stealthWpm: 220,
        stealthCoffeeBreakAtivo: true,
        stealthIntervaloCoffeeBreakMin: 25,
        stealthIntervaloCoffeeBreakMax: 40,
        stealthCoffeeBreakDuracaoMedia: 60000,
        // Modo rápido: questões confirmadamente SEM gabarito (payload já
        // interceptado) são coletadas em ~0,5s, com jitter e rajadas para
        // não produzir cadência mecânica no fluxo de XHR do site.
        rapidoSemGabaritoAtivo: true,
        rapidoDelayMin: 300,
        rapidoDelayMax: 800,
        rapidoPollInterval: 120,
        rapidoCacheEsperaMs: 2000,
        rapidoCoffeeBreakAtivo: true,
        rapidoCoffeeBreakIntervaloMin: 30,
        rapidoCoffeeBreakIntervaloMax: 60,
        rapidoCoffeeBreakDuracaoMedia: 9000,
        rapidoPausaAbaOculta: true,
        // Interceptação do gabarito: XHR sempre; fetch apenas se o site
        // migrar para fetch (cada patch extra é superfície de detecção).
        interceptarFetch: false
    };

