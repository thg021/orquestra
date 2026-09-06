import "reflect-metadata";
import { bootstrap } from "./bootstrap";

bootstrap(process.env)
  .then(async (result) => {
    if (result.app) {
      await result.app.listen(result.config.API_PORT);
      console.log(`orquestra: api ouvindo na porta ${result.config.API_PORT}`);
    } else {
      console.log(`orquestra: papel "${result.config.PROCESS_ROLE}" ainda não implementado (chega no M2)`);
    }
  })
  .catch((error: unknown) => {
    console.error("orquestra: falha na inicialização", error);
    process.exit(1);
  });
