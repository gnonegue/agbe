-- Réponse à un message du chat (salon ou conversation privée) : identifiant du message cité.
ALTER TABLE "chat_message" ADD COLUMN "replyToId" UUID;
