import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import '@/features/diagnostic/diagnostic.css';

export default function DiagnosticPrivacy() {
  return (
    <main className="gt-diagnostic gt-privacy" data-clarity-mask="true">
      <article>
        <Link to="/diagnostico" className="gt-text-button"><ArrowLeft size={17} aria-hidden="true" /> Voltar ao diagnóstico</Link>
        <div className="gt-monogram" aria-label="Gabriel Trindade">GT<span /></div>
        <h1>Seus dados, com propósito.</h1>
        <p className="gt-privacy-intro">Política de Privacidade do Diagnóstico de Crescimento de Gabriel Trindade.</p>
        <h2>O que você compartilha</h2>
        <p>Nome, telefone ou e-mail, informações da sua empresa e respostas sobre sua operação. Cada resposta é salva quando você a envia, mesmo que você não conclua o diagnóstico.</p>
        <h2>Para que usamos essas informações</h2>
        <p>Para entender o momento da sua operação, preparar seu diagnóstico e entrar em contato sobre o diagnóstico solicitado. Não utilizamos essas informações para outras finalidades sem uma base legal adequada e, quando necessário, um novo consentimento.</p>
        <h2>Como o diagnóstico funciona</h2>
        <p>As respostas seguem regras de qualificação. Quando disponível, inteligência artificial auxilia na interpretação e no resumo. Essa análise é inicial e pode ser revisada por Gabriel; ela não representa promessa de resultado nem decisão que limite seu acesso a serviços.</p>
        <h2>Armazenamento e serviços envolvidos</h2>
        <p>As respostas ficam no banco de dados do serviço, com acesso administrativo restrito. Prestadores de hospedagem, banco de dados, e-mail e inteligência artificial podem processar as informações necessárias para prestar esse serviço. Notificações sobre o diagnóstico são enviadas à operação de Gabriel Trindade.</p>
        <p>Neste navegador, guardamos um identificador e uma credencial de sessão para permitir que você retome a conversa. Evite compartilhar seu navegador ou dispositivo enquanto o diagnóstico estiver salvo. Apagar os dados do navegador remove esse acesso local; isso não apaga as respostas já enviadas.</p>
        <h2>Origem da visita</h2>
        <p>Registramos a origem do acesso, parâmetros de campanha e eventos de uso, como início, respostas e conclusão. Isso ajuda a entender quais canais geram diagnósticos e onde a experiência pode melhorar.</p>
        <h2>Seus direitos e contato</h2>
        <p>Você pode solicitar acesso, correção ou exclusão dos seus dados e revogar o consentimento. Para fazer uma solicitação a Gabriel Trindade, utilize o canal pelo qual você recebeu este diagnóstico. Informe que o pedido se refere ao Diagnóstico de Crescimento, sem enviar informações sensíveis desnecessárias.</p>
        <p>Os dados devem ser mantidos apenas pelo período necessário ao diagnóstico e ao contato solicitado, observadas as obrigações legais aplicáveis. Respostas abertas não devem incluir senhas, informações de saúde, documentos ou dados pessoais de terceiros.</p>
        <Link to="/diagnostico" className="gt-primary-button">Continuar meu diagnóstico <ArrowLeft className="gt-forward" size={18} aria-hidden="true" /></Link>
      </article>
    </main>
  );
}
