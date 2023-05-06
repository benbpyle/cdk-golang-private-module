import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as sf from "aws-cdk-lib/aws-stepfunctions";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import {
    Choice,
    Condition,
    IChainable,
    IStateMachine,
    LogLevel,
    Succeed,
} from "aws-cdk-lib/aws-stepfunctions";
import * as logs from "aws-cdk-lib/aws-logs";
import {
    CallAwsService,
    LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { IUserPool } from "aws-cdk-lib/aws-cognito";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { GoFunction } from "@aws-cdk/aws-lambda-go-alpha";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface CompanyUpdatedStateMachineProps {
    // funcs: Map<string, IFunction>
    region: string;
    companyUpdaterFunc: GoFunction;
    companyLocationUpdaterFunc: GoFunction;
}

export class CompanyUpdatedStateMachine extends Construct {
    private _stateMachine: sf.StateMachine;

    get stateMachine(): IStateMachine {
        return this._stateMachine;
    }

    constructor(
        scope: Construct,
        id: string,
        props: CompanyUpdatedStateMachineProps
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
        props: CompanyUpdatedStateMachineProps
    ) => {
        const logGroup = new logs.LogGroup(this, "CloudwatchLogs", {
            logGroupName: "/aws/vendedlogs/states/main-company-updated",
        });

        const role = new Role(this, "StateMachineUserPoolRole", {
            assumedBy: new ServicePrincipal(
                `states.${props.region}.amazonaws.com`
            ),
            // inlinePolicies: {
            //     userPoolAdmin: userPoolAdmin,
            // },
        });

        const flow = this.buildStateMachine(scope, props);

        this._stateMachine = new stepfunctions.StateMachine(
            this,
            "StateMachine",
            {
                role: role,
                stateMachineName: "UserProfileCompanyUpater",
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

        // table.grantReadWriteData(this._stateMachine);
        // tableKey.grantEncryptDecrypt(this._stateMachine);
    };

    /**
     * Creates the workflow for the state machine.  Builds transitions and errors/catches/retries
     *
     *  @param {Construct} scope - the context for the state machine
     */
    buildStateMachine = (
        scope: Construct,
        props: CompanyUpdatedStateMachineProps
    ): stepfunctions.IChainable => {
        const companyUpdate = this.buildUpdateDynamoDBCompanyFromCompany(
            props.companyUpdaterFunc
        );
        const locationUpdate = this.buildUpdateDynamoDBCompanyFromLocation(
            props.companyLocationUpdaterFunc
        );

        companyUpdate.next(new Succeed(scope, "CompanySucceed"));
        locationUpdate.next(new Succeed(scope, "LocationSucceed"));

        return this.buildInitialChoice(scope, companyUpdate, locationUpdate);
    };

    buildInitialChoice = (
        scope: Construct,
        company: IChainable,
        location: IChainable
    ): IChainable => {
        return new Choice(scope, "Company or Location", {
            comment:
                "Decide if this is a Company Update or a Company Location Update",
        })
            .when(
                Condition.stringEquals("$.detail-type", "CompanyChange"),
                company
            )
            .when(
                Condition.stringEquals(
                    "$.detail-type",
                    "CompanyLocationChange"
                ),
                location
            )
            .otherwise(new Succeed(scope, "Nothing to process"));
    };

    buildUpdateDynamoDBCompanyFromLocation = (
        func: IFunction
    ): LambdaInvoke => {
        const liFun = new LambdaInvoke(this, "Update Company from Location", {
            comment: "Updates the Company from Location in DynamoDB",
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

    buildUpdateDynamoDBCompanyFromCompany = (func: IFunction): LambdaInvoke => {
        const liFun = new LambdaInvoke(this, "Update Company from Company", {
            comment: "Updates the Company in DynamoDB",
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
