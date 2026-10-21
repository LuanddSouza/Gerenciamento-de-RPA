
const axios = require('axios');

const BASE_URL = (
    process.env.ROBERTY_API_URL ||
    'https://api.roberty.app/v4'
).replace(/\/+$/, '');

const http = axios.create({
    baseURL: BASE_URL,
    timeout: 20000,
    headers: {
        Accept: 'application/json'
    }
});

let cookieJar = '';
let loginPromise = null;
let ultimaAutenticacao = 0;

const CACHE_LOGIN_MS = 5 * 60 * 1000;

function extrairCookies(headers) {
    const setCookie = headers['set-cookie'] || [];

    if (!setCookie.length) {
        return '';
    }

    return setCookie
        .map(cookie => cookie.split(';')[0])
        .filter(Boolean)
        .join('; ');
}

async function loginRoberty(forcar = false) {
    if (loginPromise) {
        await loginPromise;
    }

    if (
        !forcar &&
        cookieJar &&
        Date.now() - ultimaAutenticacao < CACHE_LOGIN_MS
    ) {
        return;
    }

    loginPromise = (async () => {
        const email = process.env.ROBERTY_EMAIL;
        const password = process.env.ROBERTY_PASSWORD;

        if (!email || !password) {
            throw new Error(
                'Configure ROBERTY_EMAIL e ROBERTY_PASSWORD no .env'
            );
        }

        const response = await http.post('/auth/login', {
            email,
            password
        });

        const cookies = extrairCookies(response.headers);

        if (!cookies) {
            throw new Error(
                'Login Roberty não retornou Set-Cookie.'
            );
        }

        cookieJar = cookies;
        ultimaAutenticacao = Date.now();
    })();

    try {
        await loginPromise;
    } finally {
        loginPromise = null;
    }
}

async function getRoberty(url, params, repetiuLogin = false, tentativas = 0) {
    await loginRoberty();

    try {
        return await http.get(url, {
            params,
            headers: { Cookie: cookieJar }
        });
    } catch (err) {
        const status = err.response?.status;

        if ([401, 403].includes(status) && !repetiuLogin) {
            cookieJar = '';
            ultimaAutenticacao = 0;

            await loginRoberty(true);
            return getRoberty(url, params, true, tentativas);
        }

        if (status >= 500 && tentativas < 1) {
            await new Promise(resolve =>
                setTimeout(resolve, 500 + Math.random() * 500)
            );

            return getRoberty(url, params, repetiuLogin, tentativas + 1);
        }

        throw err;
    }
}

function dataLocalISO(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');

    return `${ano}-${mes}-${dia}`;
}

function intervaloDatas() {
    // Usa o fuso horário do servidor.
    // Configure TZ=America/Sao_Paulo no ambiente do processo.
    const hoje = new Date();
    const ontem = new Date(hoje);

    ontem.setDate(ontem.getDate() - 1);

    return {
        startDate: dataLocalISO(ontem),
        endDate: dataLocalISO(hoje)
    };
}

async function comConcorrencia(itens, limite, fn) {
    const resultados = new Array(itens.length);
    let proximo = 0;

    async function trabalhador() {
        while (true) {
            const indice = proximo++;

            if (indice >= itens.length) {
                return;
            }

            try {
                resultados[indice] = await fn(itens[indice]);
            } catch (err) {
                resultados[indice] = {
                    _erro: err.message
                };
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(limite, itens.length) },
            () => trabalhador()
        )
    );

    return resultados;
}

async function buscarTodasAsPaginas(url, params = {}) {
    const primeira = await getRoberty(url, {
        ...params,
        page: 1,
        limit: 100
    });

    const dados = primeira.data;
    const registros = [...(dados.records || [])];

    const paginas = Number(dados.metadata?.pages || 1);

    for (let pagina = 2; pagina <= paginas; pagina++) {
        const resposta = await getRoberty(url, {
            ...params,
            page: pagina,
            limit: 100
        });

        registros.push(...(resposta.data.records || []));
    }

    return registros;
}

async function buscarRobosEmExecucao() {
    // 1. Descobrir a workspace
    const loggedResponse = await getRoberty('/auth/logged');
    const workspaces = loggedResponse.data.workspaces || [];

    if (!workspaces.length) {
        throw new Error('Nenhuma workspace encontrada.');
    }

    // O usuário informou que possui somente uma workspace.
    const workspace = workspaces[0];
    const workspaceId = workspace._id;

    // 2. Listar todos os dispositivos
    const dispositivos = await buscarTodasAsPaginas(
        `/workspaces/${encodeURIComponent(workspaceId)}/devices`,
        { status: '' }
    );

    // 3. Listar todos os robôs de cada dispositivo
    const robosPorDispositivo = await comConcorrencia(
        dispositivos,
        4,
        async dispositivo => {
            const robos = await buscarTodasAsPaginas(
                `/devices/${encodeURIComponent(dispositivo._id)}/robots`
            );

            return robos.map(robo => ({
                ...robo,
                dispositivo
            }));
        }
    );

    const robos = robosPorDispositivo
        .filter(Array.isArray)
        .flat();

    // 4. Consultar designer e execuções
    const datas = intervaloDatas();

    const resultados = await comConcorrencia(
        robos,
        4,
        async robo => {
            const designId = robo.design?._id;

            if (!designId) {
                return [];
            }

            const designResponse = await getRoberty(
                `/designer/${encodeURIComponent(designId)}`
            );

            const designer = designResponse.data.designer;

            if (!designer?._id) {
                return [];
            }

            // A consulta asRobot é prioritária.
            let robotData = {};
            let nomeRobo = robo.name || 'Robô sem nome';

            try {
                const robotResponse = await getRoberty(
                    `/designer/${encodeURIComponent(designer._id)}/asRobot`
                );

                robotData = robotResponse.data.robot || {};

                if (robotData.name) {
                    nomeRobo = robotData.name;
                }
            } catch (err) {
                // Mantém os dados do designer se asRobot falhar.
                robotData = designer.robot || {};
            }

            const runs = await buscarTodasAsPaginas(
                `/designer/${encodeURIComponent(designer._id)}/asRobot/runs`,
                {
                    startDate: datas.startDate,
                    endDate: datas.endDate
                }
            );

            return runs
                .filter(registro => {
                    const run = registro.run || {};

                    return run.startDate && !run.endDate;
                })
                .map(registro => ({
                    id: registro.run?._id,
                    nome: registro.robot?.name || nomeRobo,
                    dispositivo:
                        registro.device?.name ||
                        robo.dispositivo?.name ||
                        'Não informado',
                    inicio: registro.run.startDate,
                    tipo: registro.run.kind || 'Não informado',
                    designId: designer._id
                }));
        }
    );

    return resultados
        .filter(Array.isArray)
        .flat()
        .sort(
            (a, b) =>
                new Date(a.inicio) - new Date(b.inicio)
        );
}

module.exports = {
    buscarRobosEmExecucao
};
