DROP TABLE acct.webhook_delivery;
DROP TABLE acct.webhook_endpoint;
DROP TABLE public.api_client;
DROP TRIGGER audit_log_chain ON acct.audit_log;
DROP FUNCTION acct.audit_chain();
