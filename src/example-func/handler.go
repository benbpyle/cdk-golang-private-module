package main

import (
	"context"

	"github.com/aws/aws-lambda-go/lambda"
	fhirutils "github.com/curantis-solutions/fhir-utils-go"
	"github.com/samply/golang-fhir-models/fhir-models/fhir"
	"github.com/sirupsen/logrus"
)

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event interface{}) error {
	logrus.Info("Logging out the handler")

	hev := fhirutils.NewHealthLakeEntityValidatory("", "", "us-west-2", fhirutils.NewHttpClient())
	_ = hev.CanAccessResource(context.TODO(), true, []string{}, []fhir.Extension{{}})

	return nil
}
