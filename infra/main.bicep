param location string = 'swedencentral'
param suffix string = '16681c6a'
param vaultName string = 'kv-research-dev-16681c6a'
param bootstrapPrincipalId string
param processingVersion string = '2'
param sandboxSnapshot string = '4daeeb76-0b95-4d8b-9c36-32ea7167fcde'
param githubSubject string = 'repo:DrBushyTop@22717844/research-capture-knowledge-base@1405750793:ref:refs/heads/master'
var tags = { application: 'research-capture-knowledge-base', environment: 'development' }
var blobOwner = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var blobContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var queueContributor = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var tableContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var secretUser = '4633458b-17de-408a-b874-0445c86b69e6'

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: 'id-research-worker-dev', location: location, tags: tags }
resource ciIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: 'id-research-ci-dev', location: location, tags: tags }
resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: ciIdentity
  name: 'github-master'
  properties: { issuer: 'https://token.actions.githubusercontent.com', subject: githubSubject, audiences: ['api://AzureADTokenExchange'] }
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stresearchdev${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: { minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true, allowBlobPublicAccess: false, allowSharedKeyAccess: false, accessTier: 'Hot' }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 7 }, containerDeleteRetentionPolicy: { enabled: true, days: 7 } }
}
resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for name in ['pipeline', 'raw', 'deployment']: {
  parent: blobs
  name: name
  properties: { publicAccess: 'None' }
}]
resource queues 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = { parent: storage, name: 'default' }
resource processingQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = { parent: queues, name: 'processing' }
resource poisonQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = { parent: queues, name: 'processing-poison' }
resource chatQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = { parent: queues, name: 'chat' }
resource chatPoisonQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = { parent: queues, name: 'chat-poison' }
resource chatRetention 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: { rules: [{
      name: 'expire-chat-questions'
      enabled: true
      type: 'Lifecycle'
      definition: {
        filters: { blobTypes: ['blockBlob'], prefixMatch: ['pipeline/chat/jobs/', 'pipeline/chat/users/'] }
        actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 1 } } }
      }
    }] }
  }
}
resource sandboxes 'Microsoft.App/sandboxGroups@2026-02-01-preview' = {
  name: 'sbg-research-chat-dev'
  location: location
  tags: tags
  properties: { allowedLocations: [location], enableDetailedMetrics: false }
}
resource workerSandboxRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sandboxes.id, workerIdentity.id, 'sandbox-data-owner')
  scope: sandboxes
  properties: {
    principalId: workerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'c24cf47c-5077-412d-a19c-45202126392c')
  }
}
resource workerStorageRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in [blobOwner, queueContributor, tableContributor]: {
  name: guid(storage.id, workerIdentity.id, role)
  scope: storage
  properties: { principalId: workerIdentity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role) }
}]
resource bootstrapStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, bootstrapPrincipalId, blobOwner)
  scope: storage
  properties: { principalId: bootstrapPrincipalId, principalType: 'User', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobOwner) }
}
resource bootstrapQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, bootstrapPrincipalId, queueContributor)
  scope: storage
  properties: { principalId: bootstrapPrincipalId, principalType: 'User', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', queueContributor) }
}
resource ciBlobRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for index in [0, 2]: {
  name: guid(containers[index].id, ciIdentity.id, blobContributor)
  scope: containers[index]
  properties: { principalId: ciIdentity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobContributor) }
}]
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }
resource secrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = [for name in ['zotero-api-key', 'zotero-account-id']: { parent: vault, name: name }]
resource secretRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for index in [0, 1]: {
  name: guid(secrets[index].id, workerIdentity.id, secretUser)
  scope: secrets[index]
  properties: { principalId: workerIdentity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretUser) }
}]
resource ai 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: 'ai-research-dev-${suffix}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: { customSubDomainName: 'ai-research-dev-${suffix}', disableLocalAuth: true, publicNetworkAccess: 'Enabled' }
}
resource model 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: ai
  name: 'research-sol'
  sku: { name: 'DataZoneStandard', capacity: 1000 }
  properties: { model: { format: 'OpenAI', name: 'gpt-6.1-sol', version: '2026-09-29' }, versionUpgradeOption: 'OnceCurrentVersionExpired' }
}
resource aiRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for index in [0, 1]: {
  name: guid(ai.id, string(index), 'OpenAIUser')
  scope: ai
  properties: { principalId: index == 0 ? workerIdentity.properties.principalId : bootstrapPrincipalId, principalType: index == 1 ? 'User' : 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd') }
}]
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-research-dev'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: json('0.1') } }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-research-dev'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id, DisableLocalAuth: true }
}
resource metricsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, workerIdentity.id, 'metrics')
  scope: insights
  properties: { principalId: workerIdentity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb') }
}
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-research-dev'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}
resource worker 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-research-dev-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${workerIdentity.id}': {} } }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: { minTlsVersion: '1.2' }
    functionAppConfig: {
      deployment: { storage: { type: 'blobContainer', value: '${storage.properties.primaryEndpoints.blob}deployment', authentication: { type: 'UserAssignedIdentity', userAssignedIdentityResourceId: workerIdentity.id } } }
      runtime: { name: 'node', version: '22' }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048, triggers: { http: { perInstanceConcurrency: 1 } } }
    }
  }
  dependsOn: [workerStorageRoles, secretRoles]
}
resource settings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: worker
  name: 'appsettings'
  properties: {
    AzureWebJobsStorage__accountName: storage.name
    AzureWebJobsStorage__credential: 'managedidentity'
    AzureWebJobsStorage__clientId: workerIdentity.properties.clientId
    STORAGE_ACCOUNT: storage.name
    AZURE_CLIENT_ID: workerIdentity.properties.clientId
    KEY_VAULT_URI: vault.properties.vaultUri
    FOUNDRY_ENDPOINT: 'https://${ai.name}.openai.azure.com'
    FOUNDRY_DEPLOYMENT: model.name
    APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
    APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${workerIdentity.properties.clientId};Authorization=AAD'
    PROCESSING_VERSION: processingVersion
    AZURE_SUBSCRIPTION_ID: subscription().subscriptionId
    AZURE_RESOURCE_GROUP: resourceGroup().name
    SANDBOX_REGION: location
    SANDBOX_GROUP: sandboxes.name
    SANDBOX_SNAPSHOT: sandboxSnapshot
  }
}
resource ciDeployRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(worker.id, ciIdentity.id, 'website-contributor')
  scope: worker
  properties: { principalId: ciIdentity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'de139f84-1756-47ae-9be6-808fbbe84772') }
}
resource reader 'Microsoft.Web/staticSites@2024-04-01' = {
  name: 'swa-research-dev'
  location: 'westeurope'
  tags: tags
  sku: { name: 'Free', tier: 'Free' }
  properties: { stagingEnvironmentPolicy: 'Disabled', allowConfigFileUpdates: true }
}
output storageAccount string = storage.name
output functionApp string = worker.name
output readerUrl string = 'https://${reader.properties.defaultHostname}'
output ciClientId string = ciIdentity.properties.clientId
output tenantId string = subscription().tenantId
output foundryEndpoint string = 'https://${ai.name}.openai.azure.com'
output foundryDeployment string = model.name
