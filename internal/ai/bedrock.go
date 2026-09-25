package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

const defaultBedrockClaudeModel = "anthropic.claude-opus-5-5"

type bedrockProvider struct {
	model    string
	region   string
	profile  string
	endpoint string
}

func newBedrockProvider(model, region, profile, endpoint string) *bedrockProvider {
	if strings.TrimSpace(model) == "" {
		model = defaultBedrockClaudeModel
	}
	return &bedrockProvider{
		model: strings.TrimSpace(model), region: strings.TrimSpace(region),
		profile: strings.TrimSpace(profile), endpoint: strings.TrimRight(strings.TrimSpace(endpoint), "/"),
	}
}

func (p *bedrockProvider) Name() string { return "amazon-bedrock" }

func loadBedrockConfig(ctx context.Context, region, profile string) (aws.Config, error) {
	options := make([]func(*awsconfig.LoadOptions) error, 0, 2)
	if strings.TrimSpace(region) != "" {
		options = append(options, awsconfig.WithRegion(strings.TrimSpace(region)))
	}
	if strings.TrimSpace(profile) != "" {
		options = append(options, awsconfig.WithSharedConfigProfile(strings.TrimSpace(profile)))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, options...)
	if err != nil {
		return aws.Config{}, fmt.Errorf("load AWS credentials/profile: %w", err)
	}
	if strings.TrimSpace(cfg.Region) == "" {
		return aws.Config{}, fmt.Errorf("AWS region is missing: set it in AI Settings, AWS_REGION, or the selected AWS profile")
	}
	return cfg, nil
}

func (p *bedrockProvider) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	cfg, err := loadBedrockConfig(ctx, p.region, p.profile)
	if err != nil {
		return CompletionResponse{}, err
	}
	client := bedrockruntime.NewFromConfig(cfg, func(options *bedrockruntime.Options) {
		if p.endpoint != "" {
			options.BaseEndpoint = aws.String(p.endpoint)
		}
	})

	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	if maxTokens > 1<<31-1 {
		maxTokens = 1<<31 - 1
	}
	input := &bedrockruntime.ConverseInput{
		ModelId: aws.String(p.model),
		Messages: []types.Message{{
			Role: types.ConversationRoleUser,
			Content: []types.ContentBlock{
				&types.ContentBlockMemberText{Value: req.UserPrompt},
			},
		}},
		InferenceConfig: &types.InferenceConfiguration{MaxTokens: aws.Int32(int32(maxTokens))},
	}
	if strings.TrimSpace(req.SystemPrompt) != "" {
		input.System = []types.SystemContentBlock{
			&types.SystemContentBlockMemberText{Value: req.SystemPrompt},
		}
	}

	result, err := client.Converse(ctx, input)
	if err != nil {
		return CompletionResponse{}, fmt.Errorf("Amazon Bedrock Converse failed: %w", err)
	}
	message, ok := result.Output.(*types.ConverseOutputMemberMessage)
	if !ok {
		return CompletionResponse{}, fmt.Errorf("Amazon Bedrock returned an unsupported response type")
	}
	parts := make([]string, 0, len(message.Value.Content))
	for _, block := range message.Value.Content {
		if text, ok := block.(*types.ContentBlockMemberText); ok {
			parts = append(parts, text.Value)
		}
	}
	response := CompletionResponse{Text: strings.Join(parts, "")}
	if result.Usage != nil {
		response.InputTokens = int(aws.ToInt32(result.Usage.InputTokens))
		response.OutputTokens = int(aws.ToInt32(result.Usage.OutputTokens))
	}
	return response, nil
}
