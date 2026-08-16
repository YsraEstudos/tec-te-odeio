    /* =====================================================================
     * (continua — exportadores e UI nas próximas seções)
     * =================================================================== */
    window.__TecFabrica = {
        CONFIG: CONFIG,
        estado: function () { return estado; },
        iniciar: iniciar,
        parar: parar,
        continuar: continuar,
        log: log,
        GabaritoInterceptor: GabaritoInterceptor
    };
    if (typeof ocultarGlobal === 'function') ocultarGlobal('__TecFabrica', window.__TecFabrica);

