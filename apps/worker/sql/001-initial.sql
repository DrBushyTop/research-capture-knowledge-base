IF OBJECT_ID('dbo.SchemaVersions') IS NULL
  CREATE TABLE dbo.SchemaVersions (version int NOT NULL PRIMARY KEY, applied_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
IF OBJECT_ID('dbo.Records') IS NULL
BEGIN
  CREATE TABLE dbo.Records (
    record_key nvarchar(450) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    document nvarchar(max) NOT NULL CHECK (ISJSON(document) = 1),
    revision bigint NOT NULL DEFAULT 1,
    updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    kind AS CONVERT(nvarchar(60), LEFT(record_key, CHARINDEX('/', record_key + '/') - 1)) PERSISTED,
    status AS CONVERT(nvarchar(40), JSON_VALUE(document, '$.status')) PERSISTED
  );
  CREATE INDEX IX_Records_KindStatus ON dbo.Records(kind, status) INCLUDE (updated_at);
END;
IF OBJECT_ID('dbo.Leases') IS NULL
  CREATE TABLE dbo.Leases (
    lease_key nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    owner uniqueidentifier NOT NULL,
    expires_at datetime2 NOT NULL
  );
IF OBJECT_ID('dbo.Sources') IS NULL
BEGIN
  CREATE TABLE dbo.Sources (
    source_id nvarchar(100) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    generation_id char(64) NOT NULL,
    title nvarchar(2000) NOT NULL,
    item_type nvarchar(100) NOT NULL,
    category_id nvarchar(48) NULL,
    published_at nvarchar(200) NULL,
    captured_at datetime2 NOT NULL,
    active bit NOT NULL,
    note_json nvarchar(max) NOT NULL CHECK (ISJSON(note_json) = 1),
    human_markdown nvarchar(max) NOT NULL DEFAULT N'',
    publication_json nvarchar(max) NOT NULL CHECK (ISJSON(publication_json) = 1),
    revision bigint NOT NULL DEFAULT 1,
    updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_Sources_CategoryCaptured ON dbo.Sources(active, category_id, captured_at DESC);
END;
IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE version = 1)
  INSERT dbo.SchemaVersions(version) VALUES (1);
