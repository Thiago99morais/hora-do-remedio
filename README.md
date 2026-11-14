# Hora do Remédio — app Android

Lembrete de horários de medicação para pacientes, principalmente idosos.
O paciente cadastra os remédios da própria receita (nome, quantidade e horários),
e o celular avisa na hora certa, mesmo bloqueado e sem internet.

- Os dados ficam **somente no celular do paciente** (nada é enviado para servidores).
- O app só lembra horários; não sugere remédios nem doses.

## Como gerar o APK (GitHub, na nuvem)

1. Envie esta pasta para um repositório **privado** no GitHub.
2. O GitHub compila sozinho a cada envio (aba **Actions** → "Gerar APK").
   Para compilar de novo manualmente: Actions → Gerar APK → **Run workflow**.
3. Quando terminar (bolinha verde, ~5–8 min), abra a execução e baixe
   **HoraDoRemedio-apk** em *Artifacts*. Dentro do .zip está o `HoraDoRemedio.apk`.

## Como instalar no celular do paciente

1. Envie o arquivo `HoraDoRemedio.apk` (por WhatsApp, cabo USB ou Google Drive).
2. No celular, toque no arquivo. O Android vai pedir para **permitir instalar apps
   desta fonte** (WhatsApp, Arquivos ou Chrome) — permita.
3. Toque em **Instalar** e depois em **Abrir**.
4. Na primeira vez, toque em **Permitir** quando o app pedir para enviar notificações.
5. Em celulares Xiaomi, Samsung, Motorola etc., para os avisos não atrasarem:
   Configurações › Apps › Hora do Remédio › Bateria › **Sem restrições**.
6. Na aba Remédios, use **"Testar o aviso"** para conferir que o som toca com a tela bloqueada.

## Atualizações

Todas as versões são assinadas com a mesma chave (`android/app/hora-do-remedio.keystore`).
Para atualizar, basta instalar o APK novo por cima — os dados do paciente são mantidos.
**Não apague nem troque essa chave**, senão o Android recusa a atualização.
Mantenha o repositório privado.

## Estrutura

- `www/` — telas do app (HTML/CSS/JS).
- `android/` — projeto Android (Capacitor 8).
- `.github/workflows/build-apk.yml` — compilação automática no GitHub.
