import { Duration, Fn } from "aws-cdk-lib";
import { Options } from "../types/options";
import { Construct } from "constructs";
import * as sf from "aws-cdk-lib/aws-stepfunctions";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Fail, IStateMachine, LogLevel } from "aws-cdk-lib/aws-stepfunctions";
import * as logs from "aws-cdk-lib/aws-logs";
import {
    CallAwsService,
    LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Key } from "aws-cdk-lib/aws-kms";
import {
    Effect,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { ITable, Table } from "aws-cdk-lib/aws-dynamodb";
import { IUserPool, UserPool } from "aws-cdk-lib/aws-cognito";
import { IFunction } from "aws-cdk-lib/aws-lambda";

interface AccoutUpdatedStateMachineProps {
    options: Options;
    userUpdaterFunc: IFunction;
    // funcs: Map<string, IFunction>
}

export class AccoutUpdatedStateMachine extends Construct {
    private _stateMachine: sf.StateMachine;

    get stateMachine(): IStateMachine {
        return this._stateMachine;
    }

    constructor(
        scope: Construct,
        id: string,
        props: AccoutUpdatedStateMachineProps
    ) {
        super(scope, id);
        this.finalizeStateMachine(scope, props);
    }

    /**
     * Sets up the state machine. Brings in the roles, permissions and appropriate keys and whatnot
     * to allow the state machine to do its thing
     *
     *  @param {Construct} scope - the context for the state machine
     *  @param {AccoutUpdatedStateMachineProps} props - passed in props from the parent
     */
    finalizeStateMachine = (
        scope: Construct,
        props: AccoutUpdatedStateMachineProps
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
            logGroupName: "/aws/vendedlogs/states/main-user-updater",
        });

        const userPoolAdmin = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    resources: [userPool.userPoolArn],
                    effect: Effect.ALLOW,
                    actions: ["cognito-idp:AdminUpdateUserAttributes"],
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
            props.userUpdaterFunc
        );

        this._stateMachine = new stepfunctions.StateMachine(
            this,
            "StateMachine",
            {
                role: role,
                stateMachineName: "UserProfileUpater",
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
        const findUser = this.buildFindUser(t);
        const updateCognitoUser = this.buildUpdateCognitoUser(u);
        const updateUser = this.buildUpdateDynamoDBUser(f);
        const rollbackCognitoUser = this.buildRollbackCognitoUser(u);

        updateUser.addCatch(rollbackCognitoUser, {
            errors: [
                "DynamoDB.ConditionalCheckFailedException",
                "DynamoDb.TransactionCanceledException",
            ],
            resultPath: "$.error",
        });

        rollbackCognitoUser.next(
            new Fail(this, "Update Failed", {
                cause: "DDB Failed to update the table",
            })
        );

        return findUser.next(updateCognitoUser).next(updateUser);
    };

    buildRollbackCognitoUser = (u: IUserPool): CallAwsService => {
        return new CallAwsService(this, "Rollback Cognito User", {
            action: "adminUpdateUserAttributes",

            iamResources: [u.userPoolArn],
            parameters: {
                UserPoolId: u.userPoolId,
                "Username.$":
                    "States.Format('{}',$.detail.messageBody.userName)",
                UserAttributes: [
                    {
                        Name: "email",
                        "Value.$": "$.detail.record.emailAddress",
                    },
                ],
            },
            resultPath: "$.cognitoOutput",
            service: "cognitoidentityprovider",
        });
    };

    buildUpdateCognitoUser = (u: IUserPool): CallAwsService => {
        return new CallAwsService(this, "Update Cognito User", {
            action: "adminUpdateUserAttributes",

            iamResources: [u.userPoolArn],
            parameters: {
                UserPoolId: u.userPoolId,
                "Username.$":
                    "States.Format('{}',$.detail.messageBody.userName)",
                UserAttributes: [
                    {
                        Name: "email",
                        "Value.$": "$.detail.messageBody.emailAddress",
                    },
                ],
            },
            resultPath: "$.cognitoOutput",
            service: "cognitoidentityprovider",
        });
    };

    buildFindUser = (t: ITable): CallAwsService => {
        return new CallAwsService(this, "DDB Find User", {
            action: "getItem",
            iamResources: [t.tableArn],
            parameters: {
                TableName: "UserProfile",
                Key: {
                    PK: {
                        "S.$": "States.Format('USERPROFILE#{}', $.detail.messageBody.userName)",
                    },
                    SK: {
                        "S.$": "States.Format('USERPROFILE#{}', $.detail.messageBody.userName)",
                    },
                },
            },

            resultPath: "$.record",
            service: "dynamodb",
        });
    };

    buildUpdateDynamoDBUser = (func: IFunction): LambdaInvoke => {
        const liFun = new LambdaInvoke(this, "User Updater", {
            comment: "Updates the User in DynamoDB",
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
}
