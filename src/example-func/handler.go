package main

import (
	"context"

	"github.com/aws/aws-lambda-go/lambda"
	s "github.com/benbpyle/golang-private-sample"
	"github.com/sirupsen/logrus"
)

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event interface{}) error {
	logrus.Info("Logging out the handler")

	s.TestMe("the handler")

	return nil
}
