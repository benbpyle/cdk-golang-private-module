import { Duration, Fn } from "aws-cdk-lib";
import { Options } from "../types/options";
import { Construct } from "constructs";
import * as sf from "aws-cdk-lib/aws-stepfunctions";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { LogLevel } from "aws-cdk-lib/aws-stepfunctions";
import * as logs from "aws-cdk-lib/aws-logs";
import {
    CallAwsService,
    LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Key } from "aws-cdk-lib/aws-kms";
import {
    Effect,
    IRole,
    Policy,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { ITable, Table } from "aws-cdk-lib/aws-dynamodb";
import { IUserPool, UserPool } from "aws-cdk-lib/aws-cognito";
import {
    AwsIntegration,
    IAuthorizer,
    RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { addCors } from "../functions/func-utils";
import { IFunction } from "aws-cdk-lib/aws-lambda";

interface UserCreationStateMachineProps {
    options: Options;
    api: RestApi;
    apiExecutionRole: IRole;
    authorizer: IAuthorizer;
    userCreatorFunc: IFunction;
    // funcs: Map<string, IFunction>
}

export class UserCreationStateMachine extends Construct {
    private _stateMachine: sf.StateMachine;

    constructor(
        scope: Construct,
        id: string,
        props: UserCreationStateMachineProps
    ) {
        super(scope, id);
        this.finalizeStateMachine(scope, props);
        this.attachApiGateway(scope, props);
    }

    /**
     * Sets up the state machine. Brings in the roles, permissions and appropriate keys and whatnot
     * to allow the state machine to do its thing
     *
     *  @param {Construct} scope - the context for the state machine
     *  @param {UserCreationStateMachineProps} props - passed in props from the parent
     */
    finalizeStateMachine = (
        scope: Construct,
        props: UserCreationStateMachineProps
    ) => {
        const tableKeyArn = Fn.importValue("main-cognito-infra-key-arn");
        const tableArn = Fn.importValue("main-cognito-infra-table-arn");
        const userPoolArn = Fn.importValue("main-cognito-infra-user-pool-arn");

        const tableKey = Key.fromKeyArn(this, "TableKey", tableKeyArn);
        const table = Table.fromTableArn(this, "Table", tableArn);
        const userPool = UserPool.fromUserPoolArn(
            this,
            "UserPool",
            userPoolArn
        );

        const logGroup = new logs.LogGroup(this, "CloudwatchLogs", {
            logGroupName: "/aws/vendedlogs/states/main-user-creation",
        });

        const userPoolAdmin = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    resources: [userPool.userPoolArn],
                    effect: Effect.ALLOW,
                    actions: ["cognito-idp:AdminCreateUser"],
                }),
            ],
        });

        const role = new Role(this, "StateMachineUserPoolRole", {
            assumedBy: new ServicePrincipal(
                `states.${props.options.defaultRegion}.amazonaws.com`
            ),
            inlinePolicies: {
                userPoolAdmin: userPoolAdmin,
            },
        });

        const flow = this.buildStateMachine(
            scope,
            table,
            userPool,
            props.userCreatorFunc
        );

        this._stateMachine = new stepfunctions.StateMachine(
            this,
            "StateMachine",
            {
                role: role,
                stateMachineName: "UserCreation",
                definition: flow,
                stateMachineType: stepfunctions.StateMachineType.EXPRESS,
                timeout: Duration.seconds(30),
                logs: {
                    level: LogLevel.ALL,
                    destination: logGroup,
                    includeExecutionData: true,
                },
            }
        );

        table.grantReadWriteData(this._stateMachine);
        tableKey.grantEncryptDecrypt(this._stateMachine);
    };

    /**
     * Attaches the state machine to an api gateway endpoint
     *
     * @param scope - the parent level construct
     * @param props - the incoming props to the construct
     */
    attachApiGateway = (
        scope: Construct,
        props: UserCreationStateMachineProps
    ) => {
        const credentialsRole = new Role(this, "StartExecution", {
            assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
        });

        credentialsRole.attachInlinePolicy(
            new Policy(this, "StartExecutionPolicy", {
                statements: [
                    new PolicyStatement({
                        actions: ["states:StartSyncExecution"],
                        effect: Effect.ALLOW,
                        resources: [this._stateMachine.stateMachineArn],
                    }),
                ],
            })
        );

        props.api.root.addMethod(
            "POST",
            new AwsIntegration({
                service: "states",
                action: "StartSyncExecution",
                integrationHttpMethod: "POST",
                options: {
                    credentialsRole,
                    requestTemplates: {
                        "application/json": `
                        #set($input = $input.json('$'))
                         {
                           "input": "$util.escapeJavaScript($input).replaceAll("\\\\'", "'")",
                            "stateMachineArn": "${this._stateMachine.stateMachineArn}"
                         }`,
                    },
                    integrationResponses: [
                        {
                            selectionPattern: "200",
                            statusCode: "200",
                            responseTemplates: {
                                "application/json": `
                                    #set ($parsedPayload = $util.parseJson($input.path('$.output')))
                                    
                                    #if($parsedPayload.response.statusCode == 400)
                                    #set($context.responseOverride.status = 400)
                                    {
                                        "message": "$parsedPayload.response.message"
                                    }
                                    #else
                                    {
                                        "firstName": "$parsedPayload.response.body.firstName",
                                        "lastName": "$parsedPayload.response.body.lastName",
                                        "emailAddress": "$parsedPayload.response.body.emailAddress",
                                        "userId": "$parsedPayload.response.body.userId"
                                    }
                                    #end
                                `,
                            },
                            responseParameters: {
                                "method.response.header.Access-Control-Allow-Methods":
                                    "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
                                "method.response.header.Access-Control-Allow-Headers":
                                    "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
                                "method.response.header.Access-Control-Allow-Origin":
                                    "'*'",
                            },
                        },
                    ],
                },
            }),
            {
                methodResponses: [
                    {
                        statusCode: "200",
                        // Allows the following `responseParameters` be specified in the `integrationResponses` section.
                        responseParameters: {
                            "method.response.header.Access-Control-Allow-Methods":
                                true,
                            "method.response.header.Access-Control-Allow-Headers":
                                true,
                            "method.response.header.Access-Control-Allow-Origin":
                                true,
                        },
                    },
                ],
                authorizer: props.authorizer,
            }
        );

        const setup = {
            functionId: "ProfileCreate",
            resource: props.api.root,
        };

        addCors(scope, setup);
    };

    /**
     * Creates the workflow for the state machine.  Builds transitions and errors/catches/retries
     *
     *  @param {Construct} scope - the context for the state machine
     *  @param {ITable} t - the DynamoDB table that the state machine uses
     *  @param {IUserPool} u - the Cognito UserPool that is used to create users
     */
    buildStateMachine = (
        scope: Construct,
        t: ITable,
        u: IUserPool,
        f: IFunction
    ): stepfunctions.IChainable => {
        const apiPass = new stepfunctions.Pass(scope, "ApiPass", {
            parameters: {
                response: {
                    statusCode: 200,
                    body: {
                        "firstName.$": "$.firstName",
                        "lastName.$": "$.lastName",
                        "emailAddress.$": "$.emailAddress",
                        "userId.$": "$.userId",
                    },
                },
            },
            comment:
                "Final state of a successful workflow that maps the outputs into a response payload",
        });

        const apiFailure = new stepfunctions.Pass(scope, "ApiFailure", {
            result: {
                value: {
                    response: {
                        message: "error creating user",
                        statusCode: 400,
                    },
                },
            },
            comment:
                "Final state of a failed workflow that maps the outputs into a response payload",
        });

        const rollbackUser = this.buildRollbackUser(t);
        const createCognitoUser = this.buildCreateCognitoUser(u);
        const correctLastId = this.buildCorrectLastId(t);
        const createDbUser = this.buildCreateDynamoDBUser(f);
        const findLastId = this.buildFindLastId(t);

        createCognitoUser.addCatch(rollbackUser, {
            errors: ["CognitoIdentityProvider.UsernameExistsException"],
            resultPath: "$.error",
        });

        createDbUser.addCatch(correctLastId, {
            errors: [
                "DynamoDB.ConditionalCheckFailedException",
                "DynamoDb.TransactionCanceledException",
            ],
            resultPath: "$.error",
        });

        correctLastId.next(findLastId);
        rollbackUser.next(apiFailure);

        return findLastId
            .next(createDbUser)
            .next(createCognitoUser)
            .next(apiPass);
    };

    buildCreateCognitoUser = (u: IUserPool): CallAwsService => {
        return new CallAwsService(this, "CreateCognitoUser", {
            action: "adminCreateUser",
            iamResources: [u.userPoolArn],
            parameters: {
                UserPoolId: u.userPoolId,
                "Username.$": "States.Format('{}',$.userId)",
                UserAttributes: [
                    {
                        Name: "email",
                        "Value.$": "$.emailAddress",
                    },
                    {
                        Name: "email_verified",
                        Value: "true",
                    },
                ],
            },
            resultPath: "$.cognitoOutput",
            service: "cognitoidentityprovider",
        });
    };

    buildRollbackUser = (t: ITable): CallAwsService => {
        return new CallAwsService(this, "RollbackUser", {
            action: "deleteItem",
            iamResources: [t.tableArn],
            parameters: {
                TableName: "UserProfile",
                Key: {
                    PK: {
                        "S.$": "States.Format('USERPROFILE#{}', $.context.userId)",
                    },
                    SK: {
                        "S.$": "States.Format('USERPROFILE#{}', $.context.userId)",
                    },
                },
            },

            resultPath: "$.results",
            service: "dynamodb",
        });
    };

    buildCorrectLastId = (t: ITable): CallAwsService => {
        return new CallAwsService(this, "CorrectLastId", {
            action: "updateItem",
            iamResources: [t.tableArn],
            parameters: {
                TableName: "UserProfile",
                ConditionExpression: "LastId = :previousUserId",
                UpdateExpression: "SET LastId = :newUserId",
                ExpressionAttributeValues: {
                    ":previousUserId": {
                        "N.$": "$.context.previousUserId",
                    },
                    ":newUserId": {
                        "N.$": "$.context.userId",
                    },
                },
                Key: {
                    PK: {
                        S: "USERMETADATA",
                    },
                    SK: {
                        S: "USERMETADATA",
                    },
                },
            },

            resultPath: "$.results",
            service: "dynamodb",
        });
    };

    buildCreateDynamoDBUser = (func: IFunction): LambdaInvoke => {
        const liFun = new LambdaInvoke(this, "UserCreator", {
            comment: "Creates the User in DynamoDB",
            outputPath: "$.Payload",
            lambdaFunction: func,
        });

        liFun.addRetry({
            backoffRate: 1,
            maxAttempts: 2,
            interval: Duration.seconds(1),
        });

        return liFun;
    };

    buildFindLastId = (t: ITable): CallAwsService => {
        return new CallAwsService(this, "FindLastId", {
            action: "getItem",
            iamResources: [t.tableArn],
            parameters: {
                TableName: t.tableName,
                ConsistentRead: true,
                Key: {
                    PK: {
                        S: "USERMETADATA",
                    },
                    SK: {
                        S: "USERMETADATA",
                    },
                },
            },
            service: "dynamodb",
            resultSelector: {
                "previousUserId.$": "$.Item.LastId.N",
                "userId.$":
                    "States.Format('{}', States.MathAdd(States.StringToJson($.Item.LastId.N), 1))",
            },
            resultPath: "$.context",
        });
    };
}
